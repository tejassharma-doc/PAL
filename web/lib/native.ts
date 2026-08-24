/**
 * Native platform wrappers.
 * On web / PWA: all functions degrade gracefully to browser equivalents or no-ops.
 * In Capacitor (iOS / Android): dynamically imports native plugins.
 *
 * Add this to any component that needs native features:
 *   import { takePhoto, requestPushPermission } from '../lib/native'
 */

export type Platform = 'ios' | 'android' | 'web'

async function getCapacitor() {
  try {
    const mod = await import('@capacitor/core')
    return mod.Capacitor
  } catch {
    return null
  }
}

export async function getPlatform(): Promise<Platform> {
  const Capacitor = await getCapacitor()
  const p = Capacitor?.getPlatform()
  if (p === 'ios') return 'ios'
  if (p === 'android') return 'android'
  return 'web'
}

export async function isNativePlatform(): Promise<boolean> {
  const Capacitor = await getCapacitor()
  return Capacitor?.isNativePlatform() ?? false
}

// ── Camera ───────────────────────────────────────────────────────────────────

export interface CameraPhoto {
  dataUrl: string
  format: 'jpeg' | 'png'
}

export async function takePhoto(): Promise<CameraPhoto | null> {
  if (typeof window === 'undefined') return null

  const native = await isNativePlatform()

  if (native) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: 90,
      })
      return photo.dataUrl ? { dataUrl: photo.dataUrl, format: 'jpeg' } : null
    } catch {
      return null
    }
  }

  // Web fallback: file input with camera capture
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      const reader = new FileReader()
      reader.onload = () => resolve({ dataUrl: reader.result as string, format: 'jpeg' })
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    }
    // No cancel event on file inputs — resolve null after reasonable wait
    setTimeout(() => resolve(null), 60_000)
    input.click()
  })
}

// ── Push notifications ───────────────────────────────────────────────────────

export async function requestPushPermission(): Promise<boolean> {
  const native = await isNativePlatform()

  if (native) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      const result = await PushNotifications.requestPermissions()
      if (result.receive === 'granted') {
        await PushNotifications.register()
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Web Push API fallback
  if ('Notification' in window) {
    const perm = await Notification.requestPermission()
    return perm === 'granted'
  }
  return false
}

// ── Biometric auth ───────────────────────────────────────────────────────────

export async function authenticateBiometric(reason = 'Verify your identity to access PAL'): Promise<boolean> {
  const native = await isNativePlatform()
  if (!native) return true // Not required on web — session token is sufficient

  try {
    // @aparajita/capacitor-biometric-auth — npm install it separately when wiring native login
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth' as never as string) as never as { BiometricAuth: { authenticate(opts: { reason: string }): Promise<void> } }
    await BiometricAuth.authenticate({ reason })
    return true
  } catch {
    return false
  }
}
