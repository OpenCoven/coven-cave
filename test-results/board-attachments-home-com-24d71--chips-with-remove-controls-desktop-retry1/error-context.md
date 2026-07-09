# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: board-attachments.spec.ts >> home composer files stage and display as chips with remove controls
- Location: tests/board-attachments.spec.ts:7:5

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
          - button "View tasks — 152 open" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
            - generic [ref=e31]: 99+
          - button "View schedules — 11 need attention" [ref=e32] [cursor=pointer]:
            - img [ref=e33]
            - generic [ref=e35]: "11"
    - generic [ref=e37]:
      - complementary "Sidebar" [ref=e40]:
        - navigation [ref=e41]:
          - 'button "Switch familiar — scope: all familiars" [ref=e44] [cursor=pointer]':
            - img [ref=e45]
          - button "New chat" [ref=e48] [cursor=pointer]:
            - img [ref=e49]
          - generic [ref=e51]:
            - button "Home — Overview and quick actions (⌘1) · drag into the page to split" [ref=e52] [cursor=pointer]:
              - img [ref=e53]
            - button "Chat — Talk with your familiars — 1:1 or a Group tab for a whole coven (⌘2) · drag into the page to split" [ref=e55] [cursor=pointer]:
              - img [ref=e56]
            - button "99+" [ref=e58] [cursor=pointer]:
              - img [ref=e59]
              - generic [ref=e61]: 99+
            - button "11" [ref=e62] [cursor=pointer]:
              - img [ref=e63]
              - generic [ref=e65]: "11"
            - button "Journal — Your familiars' daily reflections — a tab in the Grimoire" [ref=e66] [cursor=pointer]:
              - img [ref=e67]
            - button "Grimoire — Edit memory, knowledge, and journal markdown as living documents · drag into the page to split" [ref=e69] [cursor=pointer]:
              - img [ref=e70]
            - button "Marketplace — Browse the store and manage your familiars' roles, skills, and capabilities · drag into the page to split" [ref=e72] [cursor=pointer]:
              - img [ref=e73]
            - button "GitHub — Issues and PRs assigned to you · drag into the page to split" [ref=e75] [cursor=pointer]:
              - img [ref=e76]
          - generic [ref=e78]:
            - link "Dashboard" [ref=e79] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e81]
            - button "Settings" [ref=e83] [cursor=pointer]:
              - img [ref=e85]
      - separator
      - main [ref=e89]:
        - status [ref=e91]:
          - generic [ref=e92]: Daemon offline — existing sessions visible but new tasks may not start.
          - button "Start daemon" [ref=e93] [cursor=pointer]
          - button "Dismiss" [ref=e94] [cursor=pointer]:
            - img [ref=e95]
        - generic [ref=e97]:
          - heading "Home" [level=1] [ref=e98]
          - generic [ref=e99]:
            - generic [ref=e100]:
              - paragraph [ref=e101]: Good evening
              - heading "What should we build in Coven Cave?" [level=1] [ref=e103]
            - generic [ref=e105]:
              - textbox "Ask anything" [ref=e106]:
                - /placeholder: Summon something magical
              - generic [ref=e107]:
                - button [ref=e108]
                - generic [ref=e109]:
                  - generic [ref=e110]:
                    - button "Attach images, videos, or files" [ref=e111]:
                      - img [ref=e112]
                    - radiogroup "Send to" [ref=e114]:
                      - radio "Chat" [checked] [ref=e115] [cursor=pointer]:
                        - img [ref=e116]
                        - generic [ref=e118]: Chat
                      - radio "Task" [ref=e119] [cursor=pointer]:
                        - img [ref=e120]
                        - generic [ref=e122]: Task
                  - generic [ref=e123]:
                    - generic [ref=e124]:
                      - button "Enhance prompt" [disabled] [ref=e125]:
                        - img [ref=e126]
                      - button "Enhance options" [disabled] [ref=e128]:
                        - img [ref=e129]
                    - button "Send" [disabled] [ref=e131]:
                      - img [ref=e132]
              - generic [ref=e134]:
                - generic [ref=e135]:
                  - button "Choose project" [ref=e136] [cursor=pointer]:
                    - img [ref=e137]
                    - generic [ref=e139]: No project
                    - img [ref=e140]
                  - 'button "Runtime: Claude Code · Model: Claude Opus 4.8" [ref=e142] [cursor=pointer]':
                    - img [ref=e144]
                    - generic [ref=e146]: Claude Opus 4.8
                    - img
                - button "Composer options" [ref=e147]:
                  - img [ref=e148]
  - status [ref=e150]
  - alert [ref=e151]
  - alert [ref=e152]
```