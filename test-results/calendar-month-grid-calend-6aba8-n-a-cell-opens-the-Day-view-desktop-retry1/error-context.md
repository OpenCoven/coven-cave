# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-month-grid.spec.ts >> calendar month grid keyboard model >> Shift+Enter on a cell opens the Day view
- Location: tests/calendar-month-grid.spec.ts:83:7

# Error details

```
Test timeout of 60000ms exceeded.
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
          - button "Select a familiar to enhance tasks" [disabled] [ref=e25] [cursor=pointer]:
            - img [ref=e26]
          - button "View tasks" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
          - button "View schedules" [ref=e31] [cursor=pointer]:
            - img [ref=e32]
    - generic [ref=e35]:
      - complementary "Sidebar" [ref=e38]:
        - navigation [ref=e39]:
          - 'button "Switch familiar — scope: all familiars" [ref=e42] [cursor=pointer]':
            - img [ref=e43]
          - button "New chat" [ref=e46] [cursor=pointer]:
            - img [ref=e47]
          - generic [ref=e49]:
            - button "Home — Overview and quick actions (⌘1) · drag into the page to split" [ref=e50] [cursor=pointer]:
              - img [ref=e51]
            - button "Chat — Talk with your familiars — 1:1 or a Group tab for a whole coven (⌘2) · drag into the page to split" [ref=e53] [cursor=pointer]:
              - img [ref=e54]
            - button "Tasks — Track tasks across projects (⌘3) · drag into the page to split" [ref=e56] [cursor=pointer]:
              - img [ref=e57]
            - button "Schedules — Calendar and crons in one place (⌘4) · drag into the page to split" [ref=e59] [cursor=pointer]:
              - img [ref=e60]
            - button "Journal — Your familiars' daily reflections — a tab in the Grimoire" [ref=e62] [cursor=pointer]:
              - img [ref=e63]
            - button "Grimoire — Edit memory, knowledge, and journal markdown as living documents · drag into the page to split" [ref=e65] [cursor=pointer]:
              - img [ref=e66]
            - button "Marketplace — Browse the store and manage your familiars' roles, skills, and capabilities · drag into the page to split" [ref=e68] [cursor=pointer]:
              - img [ref=e69]
            - button "GitHub — Issues and PRs assigned to you · drag into the page to split" [ref=e71] [cursor=pointer]:
              - img [ref=e72]
          - generic [ref=e74]:
            - link "Dashboard" [ref=e75] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e77]
            - button "Settings" [ref=e79] [cursor=pointer]:
              - img [ref=e81]
      - separator
      - main [ref=e85]:
        - heading "Schedules" [level=1] [ref=e87]
  - status [ref=e97]
  - alert [ref=e98]
  - alert [ref=e99]
```