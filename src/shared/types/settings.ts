import { UserRole } from './user';

export interface SettingsCategory {
  id: string;
  label: string;
  icon: string;
  settings: SettingDefinition[];
}

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'range' | 'color' | 'text' | 'password';
  default: unknown;
  value: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  requires_restart: boolean;
  category: string;
  visible_to: UserRole[];
}
