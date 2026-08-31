#include <errno.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <unistd.h>

static int print_stable_identity(pid_t pid) {
  struct proc_bsdinfo before;
  struct proc_bsdinfo after;
  int before_size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before));
  if (before_size != sizeof(before)) {
    return errno == ESRCH ? 3 : 4;
  }
  pid_t sid = getsid(pid);
  if (sid < 0) {
    return errno == ESRCH ? 3 : 4;
  }
  int after_size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after));
  if (after_size != sizeof(after)) {
    return errno == ESRCH ? 3 : 4;
  }
  if (before.pbi_pid != after.pbi_pid ||
      before.pbi_ppid != after.pbi_ppid ||
      before.pbi_pgid != after.pbi_pgid ||
      before.pbi_start_tvsec != after.pbi_start_tvsec ||
      before.pbi_start_tvusec != after.pbi_start_tvusec) {
    return 5;
  }
  printf("%u\t%u\t%u\t%d\tmacos:%llu:%llu\n",
         after.pbi_pid,
         after.pbi_ppid,
         after.pbi_pgid,
         sid,
         after.pbi_start_tvsec,
         after.pbi_start_tvusec);
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    return 2;
  }
  if (strcmp(argv[1], "--all") == 0) {
    int bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
    if (bytes <= 0) {
      return 4;
    }
    int capacity = bytes + 4096;
    pid_t *pids = calloc((size_t)capacity / sizeof(pid_t), sizeof(pid_t));
    if (pids == NULL) {
      return 4;
    }
    bytes = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity);
    if (bytes <= 0 || bytes >= capacity) {
      free(pids);
      return 4;
    }
    int count = bytes / (int)sizeof(pid_t);
    for (int index = 0; index < count; index++) {
      if (pids[index] > 0) {
        (void)print_stable_identity(pids[index]);
      }
    }
    free(pids);
    return 0;
  }

  char *end = NULL;
  long raw_pid = strtol(argv[1], &end, 10);
  if (end == argv[1] || *end != '\0' || raw_pid <= 0) {
    return 2;
  }
  return print_stable_identity((pid_t)raw_pid);
}
