import { request } from './api';

export type LicenseReason =
  | 'not_activated'
  | 'corrupt_license_file'
  | 'bad_signature'
  | 'device_mismatch'
  | 'ok';

export interface LicenseStatus {
  valid: boolean;
  reason: LicenseReason;
  tier: string | null;
  license_id: string | null;
  serial: string | null;
  updates_until: string | null;
  fingerprint: string | null;
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
