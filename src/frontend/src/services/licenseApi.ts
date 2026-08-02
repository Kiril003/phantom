import { request } from './api';

export type LicenseReason =
  | 'not_activated'
  | 'corrupt_license_file'
  | 'bad_signature'
  | 'device_mismatch'
  | 'ok';

/** Чому діє саме цей рівень — окремо від того, чи цілий сертифікат. */
export type EntitlementReason =
  | 'trial'
  | 'offline_too_long'
  | 'updates_expired'
  | LicenseReason;

export type Tier = 'free' | 'personal' | 'crew' | 'unit';

export interface Entitlement {
  tier: Tier;
  reason: EntitlementReason;
  license_tier: string | null;
  trial_days_left: number;
  /** null — сервер не бачили жодного разу, пільговий строк ще не рахується. */
  grace_days_left: number | null;
  updates_until: string | null;
  build_date: string;
  features: string[];
}

export interface LicenseStatus {
  valid: boolean;
  reason: LicenseReason;
  tier: string | null;
  license_id: string | null;
  serial: string | null;
  updates_until: string | null;
  fingerprint: string | null;
  entitlement: Entitlement;
  /** Ворота ввімкнені лише у платному дистрибутиві. */
  enforced: boolean;
}

export const licenseApi = {
  status: () => request<LicenseStatus>('GET', '/license/status'),
  activate: (licenseKey: string, deviceName: string) =>
    request<LicenseStatus>('POST', '/license/activate', {
      license_key: licenseKey,
      device_name: deviceName,
    }),
  deactivate: (licenseKey: string) =>
    request<LicenseStatus>('POST', '/license/deactivate', {
      license_key: licenseKey,
    }),
  revalidate: () => request<LicenseStatus>('POST', '/license/revalidate'),
};
