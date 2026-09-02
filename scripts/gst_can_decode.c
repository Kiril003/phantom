/* Чи розбирає ЯДРО З ПАКУНКА сучасний файл — без WebKit і без продукту.
 *
 * Через dlopen, щоб зонд не лінкувався до тієї версії, яку перевіряє: інакше
 * він говорив би про себе (вже двічі за день на цьому фронті так і сталось).
 *
 * Стан PAUSED навмисно, а не PLAYING: до PAUSED конвеєр мусить знайти
 * демуксер, декодер і домовитись про формат — тобто рівно те, що WebKit
 * називає `loadedmetadata`. PLAYING вимагав би ще й звукового пристрою,
 * якого в контейнері немає, і тоді червоне казало б про стенд, а не про
 * пакунок.
 *
 * Коди: 0 — розібрав (тривалість > 0); 1 — не розібрав; 2 — немає файлу.  */
#include <stdio.h>
#include <string.h>
#include <dlfcn.h>
#include <stdint.h>

typedef void  (*init_fn)(int*, char***);
typedef void* (*parse_fn)(const char*, void**);
typedef int   (*setstate_fn)(void*, int);
typedef int   (*getstate_fn)(void*, int*, int*, int64_t);
typedef int   (*query_fn)(void*, int, int64_t*);
typedef void* (*factory_fn)(const char*);
typedef const char* (*ver_fn)(void);

#define GST_STATE_NULL 1
#define GST_STATE_PAUSED 3
#define GST_FORMAT_TIME 3

int main(int argc, char** argv) {
  if (argc < 3) { printf("вжиток: %s <libgstreamer.so> <файл>\n", argv[0]); return 2; }
  FILE* f = fopen(argv[2], "rb");
  if (!f) { printf("НЕМАЄ ФАЙЛУ: %s\n", argv[2]); return 2; }
  fclose(f);

  void* h = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!h) { printf("ядро не відкрилось: %s\n", dlerror()); return 1; }

  ver_fn      ver = (ver_fn)dlsym(h, "gst_version_string");
  init_fn      gi = (init_fn)dlsym(h, "gst_init");
  parse_fn     pa = (parse_fn)dlsym(h, "gst_parse_launch");
  setstate_fn  ss = (setstate_fn)dlsym(h, "gst_element_set_state");
  getstate_fn  gs = (getstate_fn)dlsym(h, "gst_element_get_state");
  query_fn     qd = (query_fn)dlsym(h, "gst_element_query_duration");
  factory_fn  ff = (factory_fn)dlsym(h, "gst_element_factory_find");
  if (!gi || !pa || !ss || !gs || !qd) { printf("символів бракує\n"); return 1; }

  int ac = 0; char** av = 0;
  gi(&ac, &av);
  printf("ядро: %s\n", ver ? ver() : "?");

  /* Спершу називаємо поіменно те, без чого звук неможливий. */
  const char* need[] = {"filesrc","decodebin","oggdemux","vorbisdec",
                        "audioconvert","autoaudiosink","matroskademux", NULL};
  int missing = 0;
  for (int i = 0; need[i]; i++) {
    void* got = ff ? ff(need[i]) : (void*)1;
    printf("  %-16s %s\n", need[i], got ? "є" : "НЕМАЄ");
    if (!got) missing = 1;
  }

  char desc[1024];
  snprintf(desc, sizeof desc,
           "filesrc location=\"%s\" ! decodebin ! audioconvert ! fakesink sync=false",
           argv[2]);
  void* err = NULL;
  void* pipe = pa(desc, &err);
  if (!pipe) { printf("конвеєр не побудувався\n"); return 1; }

  ss(pipe, GST_STATE_PAUSED);
  int st = 0, pend = 0;
  gs(pipe, &st, &pend, (int64_t)10 * 1000000000LL);   /* 10 с */

  int64_t dur = -1;
  int ok = qd(pipe, GST_FORMAT_TIME, &dur);
  ss(pipe, GST_STATE_NULL);

  if (ok && dur > 0) {
    printf("РОЗІБРАВ: тривалість %.3f с\n", (double)dur / 1e9);
    return missing ? 1 : 0;
  }
  printf("НЕ РОЗІБРАВ (стан=%d, тривалість=%lld)\n", st, (long long)dur);
  return 1;
}
