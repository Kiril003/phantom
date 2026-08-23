import { MachineCell } from './MachineCell';
import { ActivityCell } from './ActivityCell';
import { DevicesCell } from './DevicesCell';
import { AuditCell } from './AuditCell';

/**
 * CockpitPane — стіл «Кокпіт» (Ф4): чотири чарунки одним пейном.
 *
 * Композиція 2×2: верхній ряд — «зараз» (Машина — живі метрики,
 * Активність — живий потік agent.stream), нижній — «реєстри»
 * (Пристрої, Аудит). Одним пейном, а не чотирма пейнами стола,
 * свідомо: двигун столів ділить плитки частками ОДНОГО ряду —
 * чотири плитки на 1024 px дали б по ~256 px кожній, що вбиває
 * читабельність; а як один пейн кокпіт цілим відлітає у вільне
 * вікно чи повний екран.
 *
 * На 1024×600 сітка 2×2 без зовнішнього скролу (кожна чарунка
 * скролить своє нутро); від 1280 px чарункам стає просторо — сітка
 * добирає простір, не зумиться.
 */
export default function CockpitPane() {
  return (
    <div className="w-full h-full min-h-0 p-2 grid grid-cols-2 grid-rows-2 gap-2">
      <MachineCell />
      <ActivityCell />
      <DevicesCell />
      <AuditCell />
    </div>
  );
}
