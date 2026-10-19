#include "BoxIO.h"
#include <stdio.h>

static int fail(const char* msg) {
  printf("FAIL %s\n", msg);
  return 1;
}

int main() {
  printf("buf=%d vw=%d/%d/%d prop=%d/%d cmd=%d timers=%d pending=%d x %d watch=%d small=%d\n",
         BOXIO_BUF, BOXIO_VW_VALUE, BOXIO_VW_ENCODE, BOXIO_VW_PATH, BOXIO_PROP_VALUE,
         BOXIO_PROP_PATH, BOXIO_CMD_VALUE, BOXIO_MAX_TIMERS, BOXIO_MAX_PENDING,
         BOXIO_PENDING_LEN, BOXIO_WATCH_HOST, BOXIO_AVR_SMALL);

#if defined(BOXIO_EXPECT_CONFIG)
  if (BOXIO_BUF != 300 || BOXIO_MAX_TIMERS != 8) return fail("config override");
  if (BOXIO_MAX_PENDING != 4 || BOXIO_PENDING_LEN != 40) return fail("config left the other small sizes");
#elif defined(BOXIO_EXPECT_SMALL)
  if (BOXIO_AVR_SMALL != 1) return fail("small flag");
  if (BOXIO_BUF != 192) return fail("small buf");
  if (BOXIO_VW_VALUE != 160 || BOXIO_VW_ENCODE != 160 || BOXIO_VW_PATH != 200) return fail("small vw");
  if (BOXIO_PROP_VALUE != 120 || BOXIO_PROP_PATH != 220 || BOXIO_CMD_VALUE != 96) return fail("small prop");
  if (BOXIO_MAX_TIMERS != 6) return fail("small timers");
  if (BOXIO_MAX_PENDING != 4 || BOXIO_PENDING_LEN != 40) return fail("small pending");
  if (BOXIO_WATCH_HOST != 48) return fail("small watch");
#elif defined(BOXIO_EXPECT_MEGA)
  if (BOXIO_AVR_SMALL != 0) return fail("mega flag");
  if (BOXIO_BUF != 512) return fail("mega buf");
  if (BOXIO_VW_VALUE != 384 || BOXIO_VW_ENCODE != 384 || BOXIO_VW_PATH != 424) return fail("mega vw");
  if (BOXIO_MAX_TIMERS != 16) return fail("mega timers");
  if (BOXIO_MAX_PENDING != 12 || BOXIO_PENDING_LEN != 96) return fail("mega pending");
  if (BOXIO_WATCH_HOST != 64) return fail("mega watch");
#else
  if (BOXIO_AVR_SMALL != 0) return fail("host flag");
  if (BOXIO_BUF != 512) return fail("host buf");
  if (BOXIO_VW_VALUE != 3200 || BOXIO_VW_ENCODE != 4096 || BOXIO_VW_PATH != 4224) return fail("host grid");
  if (BOXIO_MAX_TIMERS != 16) return fail("host timers");
  if (BOXIO_MAX_PENDING != 12 || BOXIO_PENDING_LEN != 96) return fail("host pending");
  if (BOXIO_WATCH_HOST != 64) return fail("host watch");
#endif
  printf("ok\n");
  return 0;
}
