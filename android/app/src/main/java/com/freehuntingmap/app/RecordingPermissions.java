package com.freehuntingmap.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "RecordingPermissions", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class RecordingPermissions extends Plugin {
    @PluginMethod
    public void prepare(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationResult");
        } else {
            requestNotifications(call);
        }
    }

    @PermissionCallback
    private void locationResult(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is required to record a hike.", "NOT_AUTHORIZED");
            return;
        }
        requestNotifications(call);
    }

    private void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && (getPermissionState("notifications") == PermissionState.PROMPT || getPermissionState("notifications") == PermissionState.PROMPT_WITH_RATIONALE)) {
            requestPermissionForAlias("notifications", call, "notificationResult");
        } else {
            call.resolve();
        }
    }

    @PermissionCallback
    private void notificationResult(PluginCall call) {
        // Android permits foreground services even if notification permission is denied.
        call.resolve();
    }
}
