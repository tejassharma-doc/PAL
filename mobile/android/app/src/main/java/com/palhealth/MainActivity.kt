package com.palhealth

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * MainActivity — the single Android Activity that hosts the React Native bridge.
 *
 * PAL Health uses React Native's New Architecture (Fabric + TurboModules) which
 * is enabled by hermesEnabled=true and newArchEnabled=true in gradle.properties.
 *
 * All navigation and screen rendering is handled by React Navigation inside the
 * JS bundle. This Activity is just the container.
 */
class MainActivity : ReactActivity() {

    /**
     * The component registered in index.js (AppRegistry.registerComponent).
     * Must match the first argument passed to AppRegistry.registerComponent.
     */
    override fun getMainComponentName(): String = "PALHealth"

    /**
     * Creates the delegate that bootstraps the React instance.
     * fabricEnabled comes from DefaultNewArchitectureEntryPoint and reflects
     * the newArchEnabled flag in gradle.properties.
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Do NOT restore instance state — React Native manages its own state.
        super.onCreate(null)
    }
}
