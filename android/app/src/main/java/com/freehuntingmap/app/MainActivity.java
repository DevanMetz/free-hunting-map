package com.freehuntingmap.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HikeRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
