package com.freehuntingmap.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import org.json.JSONObject;

/**
 * Location foreground service for an in-progress hike.
 * The ongoing notification keeps location running with the screen locked and the app in the background.
 */
public class HikeRecordingService extends Service {
    static final String TAG = "HikeRecording";
    private static final int NOTIFICATION_ID = 7041;
    private static final String CHANNEL = "hike-recording";
    private static final long WAKE_MS = 12L * 60L * 60L * 1000L;

    private static volatile boolean running;
    private static volatile boolean explicitStop;
    private static volatile String lastError;
    private static volatile CountDownLatch starting;
    private static volatile CountDownLatch stopped;
    private static long lastAutoRestart;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private HikeRecordingStore store;
    private LocationListener listener;
    private HandlerThread thread;
    private PowerManager.WakeLock wakeLock;
    private boolean startedOk;

    static boolean isRunning() {
        return running;
    }

    /** Start again after process death, reboot, or an update while a hike is still open. */
    static void resumeIfNeeded(Context context) {
        Context app = context.getApplicationContext();
        HikeRecordingStore.Session session = HikeRecordingStore.get(app).session();
        if (session == null || !session.recording || running) return;
        if (ContextCompat.checkSelfPermission(app, android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        try {
            ContextCompat.startForegroundService(app, new Intent(app, HikeRecordingService.class));
        } catch (RuntimeException error) {
            Log.e(TAG, "resume failed", error);
        }
    }

    static String consumeError() {
        String error = lastError;
        return error == null || error.isEmpty() ? "Could not start GPS" : error;
    }

    static CountDownLatch armStart() {
        explicitStop = false;
        lastError = null;
        CountDownLatch latch = new CountDownLatch(1);
        starting = latch;
        return latch;
    }

    static CountDownLatch requestStop(Context context) {
        explicitStop = true;
        CountDownLatch latch = new CountDownLatch(1);
        stopped = latch;
        context.stopService(new Intent(context, HikeRecordingService.class));
        return latch;
    }

    static void publish(JSONObject fix) {
        HikeRecorderPlugin plugin = HikeRecorderPlugin.current();
        if (plugin == null) return;
        String json = fix.toString();
        MAIN.post(() -> {
            try {
                plugin.emitFix(new com.getcapacitor.JSObject(json));
            } catch (Exception ignored) {
                // The WebView can be paused. The fix is already in the log.
            }
        });
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        store = HikeRecordingStore.get(this);
        try {
            Notification notification = notification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            HikeRecordingStore.Session session = store.session();
            boolean allowed = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (session == null || !session.recording || !allowed) {
                lastError = "Could not start GPS";
                running = false;
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                return START_NOT_STICKY;
            }
            listen();
            if (lastError != null) {
                running = false;
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                return START_NOT_STICKY;
            }
            holdWake();
            startedOk = true;
            running = true;
            return START_STICKY;
        } catch (RuntimeException error) {
            Log.e(TAG, "foreground start failed", error);
            lastError = "Could not start GPS";
            running = false;
            stopSelf();
            return START_NOT_STICKY;
        } finally {
            CountDownLatch latch = starting;
            starting = null;
            if (latch != null) latch.countDown();
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away must not end the hike. stopWithTask is false.
    }

    @Override
    public void onDestroy() {
        HikeRecordingStore.Session session = store == null ? null : store.session();
        boolean resume = startedOk && !explicitStop && session != null && session.recording;
        listenStop();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        running = false;
        if (explicitStop && store != null) {
            try {
                store.setRecording(false);
            } catch (Exception error) {
                Log.e(TAG, "session", error);
            }
        }
        CountDownLatch latch = stopped;
        stopped = null;
        if (latch != null) latch.countDown();
        if (resume) {
            long now = SystemClock.elapsedRealtime();
            if (now - lastAutoRestart > 5_000L) {
                lastAutoRestart = now;
                Context app = getApplicationContext();
                MAIN.post(() -> resumeIfNeeded(app));
            }
        }
        super.onDestroy();
    }

    private Notification notification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.recording_channel), NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(channel);
        }
        HikeRecordingStore.Session session = store == null ? null : store.session();
        long when = session == null || session.startedAt <= 0 ? System.currentTimeMillis() : session.startedAt;
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_recording)
            .setContentTitle(getString(R.string.recording_title))
            .setContentText(getString(R.string.recording_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pending)
            .setWhen(when)
            .setUsesChronometer(true)
            .setShowWhen(true)
            .build();
    }

    @SuppressLint("MissingPermission")
    private void listen() {
        if (listener != null) return;
        LocationManager locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (locations == null) {
            lastError = "GPS unavailable";
            return;
        }
        String provider = provider(locations);
        thread = new HandlerThread("hike-gps");
        thread.start();
        listener = this::onLocation;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                LocationRequest request = new LocationRequest.Builder(1000L)
                    .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                    .setMinUpdateIntervalMillis(1000L)
                    .build();
                locations.requestLocationUpdates(provider, request, new LooperExecutor(thread.getLooper()), listener);
            } else {
                locations.requestLocationUpdates(provider, 1000L, 0f, listener, thread.getLooper());
            }
        } catch (RuntimeException error) {
            Log.e(TAG, "location updates failed", error);
            lastError = "Could not start GPS";
            listenStop();
        }
    }

    private void onLocation(Location location) {
        try {
            JSONObject fix = store.append(location);
            publish(fix);
            holdWake();
        } catch (Exception error) {
            Log.e(TAG, "could not store fix", error);
        }
    }

    private void listenStop() {
        LocationManager locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (locations != null && listener != null) {
            try {
                locations.removeUpdates(listener);
            } catch (RuntimeException ignored) {
                // The provider may already be gone.
            }
        }
        listener = null;
        if (thread != null) {
            thread.quitSafely();
            thread = null;
        }
    }

    private void holdWake() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power == null) return;
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "freehuntingmap:hike");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(WAKE_MS);
    }

    private static String provider(LocationManager locations) {
        if (enabled(locations, LocationManager.GPS_PROVIDER)) return LocationManager.GPS_PROVIDER;
        if (Build.VERSION.SDK_INT >= 31 && enabled(locations, LocationManager.FUSED_PROVIDER)) return LocationManager.FUSED_PROVIDER;
        return LocationManager.GPS_PROVIDER;
    }

    private static boolean enabled(LocationManager locations, String provider) {
        try {
            return locations.isProviderEnabled(provider);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static final class LooperExecutor implements Executor {
        private final Handler handler;

        LooperExecutor(Looper looper) {
            handler = new Handler(looper);
        }

        @Override
        public void execute(Runnable command) {
            handler.post(command);
        }
    }
}
