package com.palhealth

import android.app.ActivityManager
import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/**
 * DeviceTier — exposes hardware capability facts to JS so the app can decide
 * at runtime which features to load (e.g. skip the on-device ONNX model on
 * low-RAM phones). Exposed as constants: reading them costs nothing at runtime.
 */
class DeviceTierModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DeviceTier"

    override fun getConstants(): Map<String, Any> {
        val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        am.getMemoryInfo(memInfo)
        return mapOf(
            "totalMemoryBytes" to memInfo.totalMem.toDouble(),
            "isLowRamDevice" to am.isLowRamDevice,
        )
    }
}
