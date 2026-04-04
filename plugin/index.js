// @ts-check
"use strict";

/**
 * Expo config plugin for @ethanfritzt/react-native-playback.
 *
 * This plugin is a thin wrapper around react-native-audio-api's own config
 * plugin. Consumers only need to add @ethanfritzt/react-native-playback to their
 * plugins array — they do not need to configure react-native-audio-api
 * separately.
 *
 * Options (all optional):
 *   iosBackgroundMode       {boolean} — enable audio background mode on iOS (default: true)
 *   androidForegroundService {boolean} — enable foreground service on Android (default: true)
 *   androidFSTypes          {string[]} — foreground service types (default: ['mediaPlayback'])
 *   androidPermissions      {string[]} — additional Android permissions to add
 *
 * Usage in app.json / app.config.js:
 *   {
 *     "plugins": [
 *       ["@ethanfritzt/react-native-playback", { "iosBackgroundMode": true }]
 *     ]
 *   }
 */

const { withPlugins, createRunOncePlugin } = require("@expo/config-plugins");

/**
 * Attempt to resolve react-native-audio-api's config plugin.
 * If the peer dependency is not installed we throw a clear, actionable error.
 */
function getRNAPPlugin() {
  try {
    // react-native-audio-api ships its plugin at the package root
    // (expo.install.pluginName in their package.json points here)
    const rnap = require("react-native-audio-api/app.plugin");
    return rnap.default ?? rnap;
  } catch {
    throw new Error(
      "[@ethanfritzt/react-native-playback] Could not find react-native-audio-api plugin.\n" +
        "Make sure react-native-audio-api is installed:\n" +
        "  npx expo install react-native-audio-api\n",
    );
  }
}

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{
 *   iosBackgroundMode?: boolean;
 *   androidForegroundService?: boolean;
 *   androidFSTypes?: string[];
 *   androidPermissions?: string[];
 * }} options
 */
function withTrackPlayback(config, options = {}) {
  const {
    iosBackgroundMode = true,
    androidForegroundService = true,
    androidFSTypes = ["mediaPlayback"],
    androidPermissions = [],
    // FFmpeg is always enabled — it is required for StreamerNode, which provides
    // true HTTP streaming and eliminates the full-file-download latency on play.
    // disableFFmpeg: false is the react-native-audio-api default but we
    // forward it explicitly to make the dependency clear.
  } = options;

  const rnapPlugin = getRNAPPlugin();

  // Delegate to react-native-audio-api's plugin with the resolved options.
  // disableFFmpeg is explicitly set to false — FFmpeg is required for StreamerNode,
  // which provides true HTTP streaming (no full-file-download before playback starts).
  return withPlugins(config, [
    [
      rnapPlugin,
      {
        iosBackgroundMode,
        androidForegroundService,
        androidFSTypes,
        androidPermissions: [
          "android.permission.MODIFY_AUDIO_SETTINGS",
          "android.permission.FOREGROUND_SERVICE",
          "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
          ...androidPermissions,
        ],
        disableFFmpeg: false,
      },
    ],
  ]);
}

module.exports = createRunOncePlugin(
  withTrackPlayback,
  "@ethanfritzt/react-native-playback",
  "0.1.0",
);
