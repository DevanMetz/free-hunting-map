package com.freehuntingmap.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RecordingPermissions.class);
        super.onCreate(savedInstanceState);
    }
}
