#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uint8_t byte;
typedef bool boolean;

extern uint32_t boxio_millis;
inline uint32_t millis() { return boxio_millis; }
inline void delay(unsigned long) {}

#define F(x) x
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0

extern int boxio_pin_mode[128];
extern int boxio_pin_level[128];
inline void pinMode(int pin, int mode) {
  if (pin >= 0 && pin < 128) boxio_pin_mode[pin] = mode;
}
inline void digitalWrite(int pin, int level) {
  if (pin >= 0 && pin < 128) boxio_pin_level[pin] = level;
}

class String {
 public:
  String() : _s("") {}
  String(const char* s) : _s(s ? s : "") {}
  const char* c_str() const { return _s; }

 private:
  const char* _s;
};
