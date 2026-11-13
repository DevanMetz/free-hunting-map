package com.freehuntingmap.app;

import android.content.Context;
import android.location.Location;
import android.os.Build;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Append-only GPS log. Survives the WebView being paused or the process being killed. */
final class HikeRecordingStore {
    static final class Session {
        String trackId;
        long startedAt;
        boolean recording;
    }

    private static HikeRecordingStore instance;
    private final File dir;
    private final Object lock = new Object();
    private long nextSeq = -1;

    static synchronized HikeRecordingStore get(Context context) {
        if (instance == null) instance = new HikeRecordingStore(context.getApplicationContext());
        return instance;
    }

    private HikeRecordingStore(Context context) {
        dir = new File(context.getFilesDir(), "hike-recording");
        dir.mkdirs();
    }

    void begin(String trackId) throws IOException {
        synchronized (lock) {
            Session existing = readSession();
            if (existing != null && trackId.equals(existing.trackId)) {
                existing.recording = true;
                writeSession(existing);
                if (nextSeq < 0) nextSeq = scanMax();
                return;
            }
            if (fixes().exists() && !fixes().delete()) throw new IOException("Could not reset GPS log");
            nextSeq = 0;
            Session created = new Session();
            created.trackId = trackId;
            created.startedAt = System.currentTimeMillis();
            created.recording = true;
            writeSession(created);
        }
    }

    void setRecording(boolean recording) throws IOException {
        synchronized (lock) {
            Session session = readSession();
            if (session == null) return;
            session.recording = recording;
            writeSession(session);
        }
    }

    Session session() {
        synchronized (lock) {
            return readSession();
        }
    }

    JSONObject append(Location location) throws IOException {
        synchronized (lock) {
            if (nextSeq < 0) nextSeq = scanMax();
            long seq = ++nextSeq;
            JSONObject fix = new JSONObject();
            try {
                fix.put("seq", seq);
                fix.put("latitude", location.getLatitude());
                fix.put("longitude", location.getLongitude());
                fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 1000);
                fix.put("time", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());
                fix.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
                if (Build.VERSION.SDK_INT >= 26 && location.hasVerticalAccuracy()) fix.put("altitudeAccuracy", (double) location.getVerticalAccuracyMeters());
                else fix.put("altitudeAccuracy", JSONObject.NULL);
                fix.put("speed", location.hasSpeed() ? (double) location.getSpeed() : JSONObject.NULL);
                fix.put("bearing", location.hasBearing() ? (double) location.getBearing() : JSONObject.NULL);
            } catch (JSONException error) {
                throw new IOException(error);
            }
            dir.mkdirs();
            try (FileOutputStream out = new FileOutputStream(fixes(), true)) {
                out.write((fix.toString() + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            }
            return fix;
        }
    }

    JSONArray drain(long since) throws IOException {
        synchronized (lock) {
            JSONArray fixes = new JSONArray();
            File file = fixes();
            if (!file.exists()) return fixes;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    try {
                        JSONObject fix = new JSONObject(line);
                        if (fix.optLong("seq") > since) fixes.put(fix);
                    } catch (JSONException ignored) {
                        // A crash can leave a partial final line.
                    }
                }
            }
            return fixes;
        }
    }

    void clear() {
        synchronized (lock) {
            fixes().delete();
            new File(dir, "session.json").delete();
            nextSeq = 0;
        }
    }

    private File fixes() {
        return new File(dir, "fixes.jsonl");
    }

    private long scanMax() throws IOException {
        File file = fixes();
        if (!file.exists()) return 0;
        long max = 0;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) continue;
                try {
                    max = Math.max(max, new JSONObject(line).optLong("seq"));
                } catch (JSONException ignored) {
                    // Skip a torn line.
                }
            }
        }
        return max;
    }

    private Session readSession() {
        File file = new File(dir, "session.json");
        if (!file.exists()) return null;
        try {
            String text = new String(java.nio.file.Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(text);
            Session session = new Session();
            session.trackId = json.getString("trackId");
            session.startedAt = json.optLong("startedAt");
            session.recording = json.optBoolean("recording");
            if (session.trackId == null || session.trackId.isEmpty()) return null;
            return session;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void writeSession(Session session) throws IOException {
        dir.mkdirs();
        JSONObject json = new JSONObject();
        try {
            json.put("trackId", session.trackId);
            json.put("startedAt", session.startedAt);
            json.put("recording", session.recording);
        } catch (JSONException error) {
            throw new IOException(error);
        }
        File tmp = new File(dir, "session.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
        }
        if (!tmp.renameTo(new File(dir, "session.json"))) throw new IOException("Could not store recording session");
    }
}
