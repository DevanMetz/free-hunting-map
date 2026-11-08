package com.freehuntingmap.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;

@CapacitorPlugin(name = "HikeRecorder", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class HikeRecorderPlugin extends Plugin {
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "hike-recorder");
        thread.setDaemon(true);
        return thread;
    });
    private static volatile HikeRecorderPlugin instance;
    private HikeRecordingStore store;

    static HikeRecorderPlugin current() {
        return instance;
    }

    void emitFix(JSObject fix) {
        if (getBridge() != null) notifyListeners("fix", fix);
    }

    @Override
    public void load() {
        instance = this;
        store = HikeRecordingStore.get(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        if (!locationGranted()) requestPermissionForAlias("location", call, "locationResult");
        else requestNotifications(call);
    }

    @PermissionCallback
    private void locationResult(PluginCall call) {
        if (!locationGranted()) {
            call.reject("Location permission is required to record a hike.", "NOT_AUTHORIZED");
            return;
        }
        requestNotifications(call);
    }

    private void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && (getPermissionState("notifications") == PermissionState.PROMPT || getPermissionState("notifications") == PermissionState.PROMPT_WITH_RATIONALE)) {
            requestPermissionForAlias("notifications", call, "notificationResult");
        } else call.resolve();
    }

    @PermissionCallback
    private void notificationResult(PluginCall call) {
        // A foreground service can run when notification permission is denied; the shade entry may be hidden.
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String trackId = call.getString("trackId");
        if (trackId == null || trackId.isEmpty()) {
            call.reject("Could not start GPS");
            return;
        }
        if (!locationGranted()) {
            call.reject("Location permission is required to record a hike.", "NOT_AUTHORIZED");
            return;
        }
        if (!locationEnabled()) {
            call.reject("GPS unavailable");
            return;
        }
        EXEC.execute(() -> {
            try {
                store().begin(trackId);
                if (HikeRecordingService.isRunning()) {
                    call.resolve();
                    return;
                }
                CountDownLatch latch = HikeRecordingService.armStart();
                ContextCompat.startForegroundService(getContext(), new Intent(getContext(), HikeRecordingService.class));
                if (!latch.await(8, TimeUnit.SECONDS) || !HikeRecordingService.isRunning()) {
                    call.reject(HikeRecordingService.consumeError());
                    return;
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not start GPS");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        EXEC.execute(() -> {
            try {
                if (!HikeRecordingService.isRunning()) {
                    store().setRecording(false);
                    call.resolve();
                    return;
                }
                if (!HikeRecordingService.requestStop(getContext()).await(8, TimeUnit.SECONDS)) {
                    call.reject("Could not stop GPS");
                    return;
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not stop GPS");
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        EXEC.execute(() -> {
            try {
                if (HikeRecordingService.isRunning() && !HikeRecordingService.requestStop(getContext()).await(8, TimeUnit.SECONDS)) {
                    call.reject("Could not clear recording");
                    return;
                }
                store().clear();
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not clear recording");
            }
        });
    }

    @PluginMethod
    public void drain(PluginCall call) {
        Integer sinceValue = call.getInt("since", 0);
        long since = sinceValue == null ? 0 : sinceValue;
        EXEC.execute(() -> {
            try {
                JSONArray fixes = store().drain(since);
                JSObject result = new JSObject();
                result.put("json", fixes.toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not read GPS fixes");
            }
        });
    }

    @PluginMethod
    public void session(PluginCall call) {
        HikeRecordingStore.Session session = store().session();
        JSObject result = new JSObject();
        result.put("recording", session != null && session.recording);
        result.put("running", HikeRecordingService.isRunning());
        result.put("startedAt", session == null ? 0 : session.startedAt);
        if (session != null) result.put("trackId", session.trackId);
        call.resolve(result);
    }

    private HikeRecordingStore store() {
        if (store == null) store = HikeRecordingStore.get(getContext());
        return store;
    }

    private boolean locationGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean locationEnabled() {
        LocationManager locations = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (locations == null) return false;
        if (Build.VERSION.SDK_INT >= 28) return locations.isLocationEnabled();
        try {
            return locations.isProviderEnabled(LocationManager.GPS_PROVIDER) || locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (RuntimeException ignored) {
            return false;
        }
    }
}
