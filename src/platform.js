// Keep appearance separate from transport: Safari uses website cookies, while
// native iOS uses the same bearer-token API as Android.
export function detectPlatform({
  nativePlatform = "web",
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
  standalone = false,
} = {}) {
  const isNative = nativePlatform !== "web";
  const isIos = nativePlatform === "ios" ||
    (!isNative && (/iPad|iPhone|iPod/i.test(userAgent) ||
      (platform === "MacIntel" && maxTouchPoints > 1)));
  return {
    isIos,
    isNative,
    isAndroid: nativePlatform === "android",
    isStandalone: !!standalone,
    showInstallHelp: isIos && !isNative && !standalone,
  };
}

export function applyPlatformAppearance(document, navigator, options = {}) {
  const result = detectPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    ...options,
  });
  document.documentElement.dataset.ui = result.isIos ? "ios" : "default";
  return result;
}
