export enum SystemState {
  SHADOW = 'SHADOW',
  FOCUS = 'FOCUS',
  DIALOGUE = 'DIALOGUE',
  SENTINEL = 'SENTINEL',
  GHOST = 'GHOST',
  DREAM = 'DREAM',
}

export interface StateTransition {
  from: SystemState;
  to: SystemState;
  trigger: string;
  timestamp: number;
  auto: boolean;
}
