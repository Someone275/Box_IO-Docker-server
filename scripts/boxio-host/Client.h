#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

extern char boxio_paths[64][180];
extern int boxio_path_count;
extern int boxio_connects;
extern char boxio_last_host[80];
extern uint16_t boxio_last_port;
extern char boxio_off_host[80];
extern uint16_t boxio_off_port;
extern int boxio_off_connects;
extern char boxio_fail_host[80];
extern const char* boxio_scripted_body;

class Client {
 public:
  bool connect(const char* host, uint16_t port) {
    boxio_connects++;
    if (host) {
      strncpy(boxio_last_host, host, 79);
      boxio_last_host[79] = 0;
      boxio_last_port = port;
      if (port != 5923) {
        boxio_off_connects++;
        strncpy(boxio_off_host, host, 79);
        boxio_off_host[79] = 0;
        boxio_off_port = port;
      }
    }
    if (host && boxio_fail_host[0] && strcmp(host, boxio_fail_host) == 0) {
      _body = "";
      _i = 0;
      _n = 0;
      return false;
    }
    _body = boxio_scripted_body ? boxio_scripted_body : "\r\n\r\n{\"ok\":1}";
    _n = strlen(_body);
    _i = 0;
    return true;
  }
  bool connected() { return _i < _n; }
  void stop() { _i = _n; }
  int available() { return _i < _n ? 1 : 0; }
  int read() {
    if (!_body || _i >= _n) return -1;
    return (unsigned char)_body[_i++];
  }
  void print(const char* s) {
    if (!s || s[0] != '/') return;
    if (boxio_path_count >= 64) return;
    strncpy(boxio_paths[boxio_path_count], s, 179);
    boxio_paths[boxio_path_count][179] = 0;
    boxio_path_count++;
  }

 private:
  const char* _body = nullptr;
  size_t _i = 0;
  size_t _n = 0;
};
