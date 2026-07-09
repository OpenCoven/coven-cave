# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: familiar-work-queue.spec.ts >> familiar work queue (PR control tower) >> cleanup Close is gated on a handoff note; adding one posts a comment and unlocks it
- Location: tests/familiar-work-queue.spec.ts:136:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.fwq')
Expected: visible
Timeout: 2000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 2000ms
  - waiting for locator('.fwq')


Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

```
Tearing down "context" exceeded the test timeout of 60000ms.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to main content":
      - /url: "#shell-main-content"
    - generic [ref=e3]:
      - button "Expand navigation" [ref=e4] [cursor=pointer]:
        - img [ref=e5]
      - group "History" [ref=e7]:
        - button "Go back" [ref=e8] [cursor=pointer]:
          - img [ref=e9]
        - button "Go forward" [ref=e11] [cursor=pointer]:
          - img [ref=e12]
      - navigation "Chat with familiars and view tasks" [ref=e15]:
        - search [ref=e16]:
          - img [ref=e17]
          - searchbox "Search anything or ask Salem, the docs familiar" [ref=e19]
          - generic [ref=e20]: CtrlK
        - generic [ref=e21]:
          - button "Quick chat" [ref=e22] [cursor=pointer]:
            - img [ref=e23]
          - 'button "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats" [ref=e25] [cursor=pointer]':
            - img [ref=e26]
          - button "View tasks — 2 open" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
            - generic [ref=e31]: "2"
          - button "View schedules — 11 need attention" [ref=e32] [cursor=pointer]:
            - img [ref=e33]
            - generic [ref=e35]: "11"
    - generic [ref=e37]:
      - complementary "Sidebar" [ref=e40]:
        - navigation [ref=e41]:
          - 'button "Switch familiar — current: Kitty" [ref=e44] [cursor=pointer]':
            - img [ref=e46]
          - button "New chat" [ref=e49] [cursor=pointer]:
            - img [ref=e50]
          - generic [ref=e52]:
            - button "Home — Overview and quick actions (⌘1) · drag into the page to split" [ref=e53] [cursor=pointer]:
              - img [ref=e54]
            - button "Chat — Talk with your familiars — 1:1 or a Group tab for a whole coven (⌘2) · drag into the page to split" [ref=e56] [cursor=pointer]:
              - img [ref=e57]
            - button "2" [ref=e59] [cursor=pointer]:
              - img [ref=e60]
              - generic [ref=e62]: "2"
            - button "11" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
              - generic [ref=e66]: "11"
            - button "Journal — Your familiars' daily reflections — a tab in the Grimoire" [ref=e67] [cursor=pointer]:
              - img [ref=e68]
            - button "Grimoire — Edit memory, knowledge, and journal markdown as living documents · drag into the page to split" [ref=e70] [cursor=pointer]:
              - img [ref=e71]
            - button "Marketplace — Browse the store and manage your familiars' roles, skills, and capabilities · drag into the page to split" [ref=e73] [cursor=pointer]:
              - img [ref=e74]
            - button "GitHub — Issues and PRs assigned to you · drag into the page to split" [ref=e76] [cursor=pointer]:
              - img [ref=e77]
          - generic [ref=e79]:
            - link "Dashboard" [ref=e80] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e82]
            - button "Settings" [ref=e84] [cursor=pointer]:
              - img [ref=e86]
      - separator
      - main [ref=e90]:
        - status [ref=e92]:
          - generic [ref=e93]: Daemon offline — existing sessions visible but new tasks may not start.
          - button "Start daemon" [ref=e94] [cursor=pointer]
          - button "Dismiss" [ref=e95] [cursor=pointer]:
            - img [ref=e96]
        - heading "Queue" [level=1] [ref=e99]
  - status [ref=e108]
  - alert [ref=e109]
  - alert [ref=e110]
```