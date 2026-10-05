#include "BoxIO.h"
#include <stdio.h>
#include <string.h>

uint32_t boxio_millis = 0;
char boxio_paths[64][180];
int boxio_path_count = 0;
int boxio_connects = 0;
char boxio_last_host[80] = {0};
uint16_t boxio_last_port = 0;
char boxio_off_host[80] = {0};
uint16_t boxio_off_port = 0;
int boxio_off_connects = 0;
char boxio_fail_host[80] = {0};
const char* boxio_scripted_body = nullptr;
int boxio_pin_mode[128];
int boxio_pin_level[128];

static int fails = 0;

static void expect(bool ok, const char* msg) {
  if (ok) {
    printf("ok  %s\n", msg);
    return;
  }
  printf("FAIL %s\n", msg);
  fails++;
}

static bool saw(const char* fragment) {
  for (int i = 0; i < boxio_path_count; i++) {
    if (strstr(boxio_paths[i], fragment)) return true;
  }
  return false;
}

static int hits = 0;
static int hitsB = 0;
static void tickA() { hits++; }
static void tickB() { hitsB++; }

int main() {
  Client client;
  BoxIO.begin(client);
  BoxIO.setPollInterval(60000);

  boxio_millis = 2000;
  boxio_path_count = 0;
  for (int i = 0; i < 30; i++) BoxIO.virtualWrite(i, i);
  expect(boxio_path_count == 30, "default cap is 30 sends per second");
  BoxIO.virtualWrite(31, "extra");
  expect(boxio_path_count == 30, "the 31st virtualWrite waits");
  boxio_millis = 3000;
  BoxIO.setMaxSendsPerSecond(0);
  boxio_path_count = 0;
  BoxIO.virtualWrite(1, "flush");
  expect(saw("pin=31&value=extra") && saw("pin=1&value=flush"), "waiting write leaves when the cap is removed");

  boxio_millis = 4000;
  BoxIO.setMaxSendsPerSecond(1);
  boxio_path_count = 0;
  BoxIO.virtualWrite(V1, "only");
  BoxIO.setProperty(V1, "label", "A");
  BoxIO.setProperty(V1, "label", "B");
  expect(boxio_path_count == 3 && saw("/hw/vw?pin=1&value=only") && saw("prop=label&value=B"),
         "setProperty still sends after the virtualWrite cap is used");

  boxio_millis = 5000;
  BoxIO.setMaxSendsPerSecond(2);
  boxio_path_count = 0;
  BoxIO.virtualWrite(V1, 10);
  BoxIO.virtualWrite(V2, "20");
  BoxIO.virtualWrite(V3, "30");
  expect(boxio_path_count == 2, "two sends inside the per-second cap");
  expect(saw("pin=1&value=10"), "first value sent");
  expect(saw("pin=2&value=20"), "second value sent");
  expect(!saw("pin=3"), "third value waits");

  boxio_millis = 6000;
  boxio_path_count = 0;
  BoxIO.run();
  expect(saw("pin=3&value=30"), "queued value sends on the next second");

  boxio_millis = 7000;
  BoxIO.setMaxSendsPerSecond(1);
  boxio_path_count = 0;
  BoxIO.virtualWrite(V4, "a");
  BoxIO.virtualWrite(V4, "b");
  BoxIO.virtualWrite(V4, "c");
  expect(boxio_path_count == 1 && saw("value=a"), "only the first write of a pin uses the open slot");
  boxio_millis = 8000;
  boxio_path_count = 0;
  BoxIO.run();
  expect(boxio_path_count == 1 && saw("pin=4&value=c"), "queued pin keeps the latest value");

  uint32_t start = 9000;
  boxio_millis = start;
  BoxIO.setMaxSendsPerMinute(2);
  boxio_path_count = 0;
  BoxIO.virtualWrite(V5, "1");
  BoxIO.virtualWrite(V6, "2");
  BoxIO.virtualWrite(V7, "3");
  expect(boxio_path_count == 2, "per-minute cap allows two immediate sends");
  expect(!saw("pin=7"), "third pin waits for the next minute");
  boxio_millis = start + 1000;
  boxio_path_count = 0;
  BoxIO.virtualWrite(V8, "4");
  expect(boxio_path_count == 0, "still inside the same minute");
  boxio_millis = start + 60000;
  boxio_path_count = 0;
  BoxIO.virtualWrite(V9, "5");
  expect(saw("pin=7&value=3"), "oldest queued pin sends when the minute opens");
  expect(saw("pin=8&value=4"), "next queued pin sends in the same new minute");
  expect(!saw("pin=9"), "the new write waits after the minute budget is used");

  boxio_millis = 100;
  BoxIO.setMaxSendsPerSecond(0);
  boxio_path_count = 0;
  BoxIO.virtualWrite(V1, "z");
  expect(saw("pin=9&value=5") && saw("pin=1&value=z"), "unlimited sends flush the queue and the new value");

  hits = 0;
  hitsB = 0;
  boxio_millis = 0;
  int idA = BoxIO.setTimer(1000, tickA);
  int idB = BoxIO.setTimer(2500, tickB);
  expect(idA >= 0 && idB >= 0 && idA != idB, "two timers get different ids");
  expect(BoxIO.setTimer(0, tickA) == -1, "zero interval is rejected");
  BoxIO.run();
  expect(hits == 0 && hitsB == 0, "timers wait for their first interval");

  boxio_millis = 1000;
  BoxIO.run();
  expect(hits == 1 && hitsB == 0, "one-second timer fires alone");
  boxio_millis = 2000;
  BoxIO.run();
  expect(hits == 2 && hitsB == 0, "one-second timer fires again");
  boxio_millis = 2500;
  BoxIO.run();
  expect(hits == 2 && hitsB == 1, "slower timer fires on its own interval");
  BoxIO.deleteTimer(idA);
  BoxIO.deleteTimer(-1);
  BoxIO.deleteTimer(99);
  boxio_millis = 4000;
  BoxIO.run();
  expect(hits == 2 && hitsB == 1, "deleted timer stays stopped");
  boxio_millis = 5000;
  BoxIO.run();
  expect(hits == 2 && hitsB == 2, "remaining timer keeps its interval");

  BoxIO.deleteTimer(idB);
  int filled = 0;
  for (int i = 0; i < BOXIO_MAX_TIMERS + 2; i++) {
    if (BoxIO.setTimer(1000, tickA) >= 0) filled++;
  }
  expect(filled == BOXIO_MAX_TIMERS, "timer table reports when it is full");

  for (int i = 0; i < 128; i++) {
    boxio_pin_mode[i] = -1;
    boxio_pin_level[i] = -1;
  }
  expect(BoxIO.setPingWatchdog("", 30, 3, 2, BOX_HIGH_TO_LOW, 5) == false, "empty watchdog host is rejected");
  expect(BoxIO.setPingWatchdog("bad host", 30, 3, 2, BOX_HIGH_TO_LOW, 5) == false, "host with a space is rejected");
  expect(BoxIO.setPingWatchdog("1.1.1.1", 30, 3, 200, BOX_HIGH_TO_LOW, 5) == false, "gpio above 127 is rejected");
  expect(BoxIO.setPingWatchdog("https://example.com/health", 1, 2, 4, BOX_HIGH_TO_LOW, 3), "https target is accepted");
  expect(boxio_pin_mode[4] == OUTPUT, "watchdog sets the gpio to output");

  boxio_millis = 10000;
  boxio_fail_host[0] = 0;
  BoxIO.run();
  expect(strcmp(boxio_off_host, "example.com") == 0 && boxio_off_port == 443, "https check uses port 443");
  expect(boxio_pin_level[4] == -1, "a successful check does not pulse the gpio");

  boxio_millis = 12000;
  int offConnects = boxio_off_connects;
  BoxIO.run();
  expect(boxio_off_connects == offConnects, "a 1 second request is clamped to at least 5 seconds");

  BoxIO.clearPingWatchdog();
  expect(BoxIO.setPingWatchdog("8.8.8.8", 5, 2, 4, BOX_HIGH_TO_LOW, 3), "icmp-style host is accepted");
  strncpy(boxio_fail_host, "8.8.8.8", sizeof(boxio_fail_host) - 1);
  boxio_millis = 20000;
  BoxIO.run();
  expect(boxio_pin_level[4] == -1, "the first miss does not pulse yet");
  boxio_millis = 25000;
  BoxIO.run();
  expect(boxio_pin_level[4] == HIGH, "the second miss drives the gpio high");
  boxio_millis = 27000;
  BoxIO.run();
  expect(boxio_pin_level[4] == HIGH, "the gpio stays high during the transition");
  boxio_millis = 28000;
  BoxIO.run();
  expect(boxio_pin_level[4] == LOW, "the gpio goes low when the transition ends");
  boxio_millis = 33000;
  BoxIO.run();
  expect(boxio_pin_level[4] == LOW, "further misses in the same outage do not pulse again");

  boxio_fail_host[0] = 0;
  boxio_millis = 38000;
  BoxIO.run();
  strncpy(boxio_fail_host, "8.8.8.8", sizeof(boxio_fail_host) - 1);
  boxio_millis = 43000;
  BoxIO.run();
  boxio_millis = 48000;
  BoxIO.run();
  expect(boxio_pin_level[4] == HIGH, "a later outage can pulse the gpio again");

  boxio_fail_host[0] = 0;
  BoxIO.clearPingWatchdog();
  boxio_scripted_body =
      "\r\n\r\n{\"ok\":true,\"active\":1,\"target\":\"9.9.9.9\",\"interval\":5,\"misses\":1,\"pin\":7,\"dir\":1,\"transition\":2}";
  boxio_millis = 100000;
  BoxIO.run();
  strncpy(boxio_fail_host, "9.9.9.9", sizeof(boxio_fail_host) - 1);
  boxio_millis = 105000;
  BoxIO.run();
  expect(strcmp(boxio_off_host, "9.9.9.9") == 0 && boxio_off_port == 80, "dashboard settings are checked on the board");
  expect(boxio_pin_mode[7] == OUTPUT && boxio_pin_level[7] == LOW, "low-to-high starts by driving the gpio low");
  boxio_millis = 107000;
  BoxIO.run();
  expect(boxio_pin_level[7] == HIGH, "low-to-high finishes high after the transition");
  boxio_scripted_body = nullptr;
  boxio_fail_host[0] = 0;

  if (fails) {
    printf("%d failed\n", fails);
    return 1;
  }
  printf("all passed\n");
  return 0;
}
