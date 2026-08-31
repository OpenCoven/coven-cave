#include <errno.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/proc_info.h>

int main(int argc, char **argv) {
  if (argc != 2) {
    return 2;
  }
  char *end = NULL;
  long raw_pid = strtol(argv[1], &end, 10);
  if (end == argv[1] || *end != '\0' || raw_pid <= 0) {
    return 2;
  }

  struct proc_bsdinfo info;
  int size = proc_pidinfo((int)raw_pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  if (size != sizeof(info)) {
    return errno == ESRCH ? 3 : 4;
  }

  printf("macos:%llu:%llu\n", info.pbi_start_tvsec, info.pbi_start_tvusec);
  return 0;
}
