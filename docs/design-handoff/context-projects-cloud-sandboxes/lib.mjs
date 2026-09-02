// Shared vocabulary for the artboards — tokens lifted from
// src/styles/globals/foundations.css (dark "Coven" palette) and component
// anatomy copied from the app's stylesheets. Icons are Phosphor bodies from
// src/lib/ph-icons-subset.json (viewBox 0 0 256 256).
export const ICONS = {
  house: 'm219.31 108.68l-80-80a16 16 0 0 0-22.62 0l-80 80A15.87 15.87 0 0 0 32 120v96a8 8 0 0 0 8 8h64a8 8 0 0 0 8-8v-56h32v56a8 8 0 0 0 8 8h64a8 8 0 0 0 8-8v-96a15.87 15.87 0 0 0-4.69-11.32M208 208h-48v-56a8 8 0 0 0-8-8h-48a8 8 0 0 0-8 8v56H48v-88l80-80l80 80Z',
  kanban: 'M216 48H40a8 8 0 0 0-8 8v152a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16v-48h48v16a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V56a8 8 0 0 0-8-8M88 208H48v-80h40Zm0-96H48V64h40Zm64 32h-48V64h48Zm56 32h-40v-48h40Zm0-64h-40V64h40Z',
  code: 'M69.12 94.15L28.5 128l40.62 33.85a8 8 0 1 1-10.24 12.29l-48-40a8 8 0 0 1 0-12.29l48-40a8 8 0 0 1 10.24 12.3m176 27.7l-48-40a8 8 0 1 0-10.24 12.3L227.5 128l-40.62 33.85a8 8 0 1 0 10.24 12.29l48-40a8 8 0 0 0 0-12.29m-82.39-89.37a8 8 0 0 0-10.25 4.79l-64 176a8 8 0 0 0 4.79 10.26A8.1 8.1 0 0 0 96 224a8 8 0 0 0 7.52-5.27l64-176a8 8 0 0 0-4.79-10.25',
  folder: 'M216 72h-84.69L104 44.69A15.86 15.86 0 0 0 92.69 40H40a16 16 0 0 0-16 16v144.62A15.4 15.4 0 0 0 39.38 216h177.51A15.13 15.13 0 0 0 232 200.89V88a16 16 0 0 0-16-16M40 56h52.69l16 16H40Zm176 144H40V88h176Z',
  'folder-open': 'M245 110.64a16 16 0 0 0-13-6.64h-16V88a16 16 0 0 0-16-16h-69.33l-27.73-20.8a16.14 16.14 0 0 0-9.6-3.2H40a16 16 0 0 0-16 16v144a8 8 0 0 0 8 8h179.1a8 8 0 0 0 7.59-5.47l28.49-85.47a16.05 16.05 0 0 0-2.18-14.42M93.34 64l29.86 22.4A8 8 0 0 0 128 88h72v16H69.77a16 16 0 0 0-15.18 10.94L40 158.7V64Zm112 136H43.1l26.67-80H232Z',
  'folder-plus': 'M216 72h-84.69L104 44.69A15.86 15.86 0 0 0 92.69 40H40a16 16 0 0 0-16 16v144.62A15.4 15.4 0 0 0 39.38 216h177.51A15.13 15.13 0 0 0 232 200.89V88a16 16 0 0 0-16-16M92.69 56l16 16H40V56ZM216 200H40V88h176Zm-88-88a8 8 0 0 1 8 8v16h16a8 8 0 0 1 0 16h-16v16a8 8 0 0 1-16 0v-16h-16a8 8 0 0 1 0-16h16v-16a8 8 0 0 1 8-8',
  'github-logo': 'M208.31 75.68A59.78 59.78 0 0 0 202.93 28a8 8 0 0 0-6.93-4a59.75 59.75 0 0 0-48 24h-24a59.75 59.75 0 0 0-48-24a8 8 0 0 0-6.93 4a59.78 59.78 0 0 0-5.38 47.68A58.14 58.14 0 0 0 56 104v8a56.06 56.06 0 0 0 48.44 55.47A39.8 39.8 0 0 0 96 192v8H72a24 24 0 0 1-24-24a40 40 0 0 0-40-40a8 8 0 0 0 0 16a24 24 0 0 1 24 24a40 40 0 0 0 40 40h24v16a8 8 0 0 0 16 0v-40a24 24 0 0 1 48 0v40a8 8 0 0 0 16 0v-40a39.8 39.8 0 0 0-8.44-24.53A56.06 56.06 0 0 0 216 112v-8a58.14 58.14 0 0 0-7.69-28.32M200 112a40 40 0 0 1-40 40h-48a40 40 0 0 1-40-40v-8a41.74 41.74 0 0 1 6.9-22.48a8 8 0 0 0 1.1-7.69a43.8 43.8 0 0 1 .79-33.58a43.88 43.88 0 0 1 32.32 20.06a8 8 0 0 0 6.71 3.69h32.35a8 8 0 0 0 6.74-3.69a43.87 43.87 0 0 1 32.32-20.06a43.8 43.8 0 0 1 .77 33.58a8.09 8.09 0 0 0 1 7.65a41.7 41.7 0 0 1 7 22.52Z',
  'git-branch': 'M232 64a32 32 0 1 0-40 31v17a8 8 0 0 1-8 8H96a23.8 23.8 0 0 0-8 1.38V95a32 32 0 1 0-16 0v66a32 32 0 1 0 16 0v-17a8 8 0 0 1 8-8h88a24 24 0 0 0 24-24V95a32.06 32.06 0 0 0 24-31M64 64a16 16 0 1 1 16 16a16 16 0 0 1-16-16m32 128a16 16 0 1 1-16-16a16 16 0 0 1 16 16M200 80a16 16 0 1 1 16-16a16 16 0 0 1-16 16',
  'squares-four': 'M104 40H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16m0 64H56V56h48zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16m0 64h-48V56h48zm-96 32H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16m0 64H56v-48h48zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16m0 64h-48v-48h48z',
  sparkle: 'M197.58 129.06L146 110l-19-51.62a15.92 15.92 0 0 0-29.88 0L78 110l-51.62 19a15.92 15.92 0 0 0 0 29.88L78 178l19 51.62a15.92 15.92 0 0 0 29.88 0L146 178l51.62-19a15.92 15.92 0 0 0 0-29.88ZM137 164.22a8 8 0 0 0-4.74 4.74L112 223.85L91.78 169a8 8 0 0 0-4.78-4.78L32.15 144L87 123.78a8 8 0 0 0 4.78-4.78L112 64.15L132.22 119a8 8 0 0 0 4.74 4.74L191.85 144ZM144 40a8 8 0 0 1 8-8h16V16a8 8 0 0 1 16 0v16h16a8 8 0 0 1 0 16h-16v16a8 8 0 0 1-16 0V48h-16a8 8 0 0 1-8-8m104 48a8 8 0 0 1-8 8h-8v8a8 8 0 0 1-16 0v-8h-8a8 8 0 0 1 0-16h8v-8a8 8 0 0 1 16 0v8h8a8 8 0 0 1 8 8',
  'caret-up-down': 'M184.49 167.51a12 12 0 0 1 0 17l-48 48a12 12 0 0 1-17 0l-48-48a12 12 0 0 1 17-17L128 207l39.51-39.52a12 12 0 0 1 16.98.03m-96-79L128 49l39.51 39.52a12 12 0 0 0 17-17l-48-48a12 12 0 0 0-17 0l-48 48a12 12 0 0 0 17 17Z',
  'caret-down': 'm213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32',
  'caret-right': 'm181.66 133.66l-80 80a8 8 0 0 1-11.32-11.32L164.69 128L90.34 53.66a8 8 0 0 1 11.32-11.32l80 80a8 8 0 0 1 0 11.32',
  'caret-left': 'M165.66 202.34a8 8 0 0 1-11.32 11.32l-80-80a8 8 0 0 1 0-11.32l80-80a8 8 0 0 1 11.32 11.32L91.31 128Z',
  check: 'm229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69L218.34 66.34a8 8 0 0 1 11.32 11.32',
  plus: 'M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8',
  'note-pencil': 'm229.66 58.34l-32-32a8 8 0 0 0-11.32 0l-96 96A8 8 0 0 0 88 128v32a8 8 0 0 0 8 8h32a8 8 0 0 0 5.66-2.34l96-96a8 8 0 0 0 0-11.32M124.69 152H104v-20.69l64-64L188.69 88ZM200 76.69L179.31 56L192 43.31L212.69 64ZM224 128v80a16 16 0 0 1-16 16H48a16 16 0 0 1-16-16V48a16 16 0 0 1 16-16h80a8 8 0 0 1 0 16H48v160h160v-80a8 8 0 0 1 16 0',
  desktop: 'M208 40H48a24 24 0 0 0-24 24v112a24 24 0 0 0 24 24h72v16H96a8 8 0 0 0 0 16h64a8 8 0 0 0 0-16h-24v-16h72a24 24 0 0 0 24-24V64a24 24 0 0 0-24-24M48 56h160a8 8 0 0 1 8 8v80H40V64a8 8 0 0 1 8-8m160 128H48a8 8 0 0 1-8-8v-16h176v16a8 8 0 0 1-8 8',
  globe: 'M128 24a104 104 0 1 0 104 104A104.12 104.12 0 0 0 128 24m88 104a87.6 87.6 0 0 1-3.33 24h-38.51a157.4 157.4 0 0 0 0-48h38.51a87.6 87.6 0 0 1 3.33 24m-114 40h52a115.1 115.1 0 0 1-26 45a115.3 115.3 0 0 1-26-45m-3.9-16a140.8 140.8 0 0 1 0-48h59.88a140.8 140.8 0 0 1 0 48ZM40 128a87.6 87.6 0 0 1 3.33-24h38.51a157.4 157.4 0 0 0 0 48H43.33A87.6 87.6 0 0 1 40 128m114-40h-52a115.1 115.1 0 0 1 26-45a115.3 115.3 0 0 1 26 45m52.33 0h-35.62a135.3 135.3 0 0 0-22.3-45.6A88.29 88.29 0 0 1 206.37 88Zm-98.74-45.6A135.3 135.3 0 0 0 85.29 88H49.63a88.29 88.29 0 0 1 57.96-45.6M49.63 168h35.66a135.3 135.3 0 0 0 22.3 45.6A88.29 88.29 0 0 1 49.63 168m98.78 45.6a135.3 135.3 0 0 0 22.3-45.6h35.66a88.29 88.29 0 0 1-57.96 45.6',
  robot: 'M200 48h-64V16a8 8 0 0 0-16 0v32H56a32 32 0 0 0-32 32v112a32 32 0 0 0 32 32h144a32 32 0 0 0 32-32V80a32 32 0 0 0-32-32m16 144a16 16 0 0 1-16 16H56a16 16 0 0 1-16-16V80a16 16 0 0 1 16-16h144a16 16 0 0 1 16 16Zm-52-56H92a28 28 0 0 0 0 56h72a28 28 0 0 0 0-56m-24 16v24h-24v-24Zm-60 12a12 12 0 0 1 12-12h8v24h-8a12 12 0 0 1-12-12m84 12h-8v-24h8a12 12 0 0 1 0 24m-92-68a12 12 0 1 1 12 12a12 12 0 0 1-12-12m88 0a12 12 0 1 1 12 12a12 12 0 0 1-12-12',
  'brain-bold': 'M252 124a60.14 60.14 0 0 0-32-53.08a52 52 0 0 0-92-32.11a52 52 0 0 0-92 32.11a60 60 0 0 0 0 106.14a52 52 0 0 0 92 32.13a52 52 0 0 0 92-32.13A60.05 60.05 0 0 0 252 124M88 204a28 28 0 0 1-26.85-20.07c1 0 1.89.07 2.85.07h8a12 12 0 0 0 0-24h-8a36 36 0 0 1-12-69.95a12 12 0 0 0 8-11.32V72a28 28 0 0 1 56 0v60.18a51.6 51.6 0 0 0-7.2-3.85a12 12 0 1 0-9.6 22A28 28 0 0 1 88 204m104-44h-8a12 12 0 0 0 0 24h8c1 0 1.9 0 2.85-.07a28 28 0 1 1-38-33.61a12 12 0 1 0-9.6-22a51.6 51.6 0 0 0-7.2 3.85V72a28 28 0 0 1 56 0v6.73a12 12 0 0 0 8 11.32a36 36 0 0 1-12 70Zm16-44a12 12 0 0 1-12 12a40 40 0 0 1-40-40v-4a12 12 0 0 1 24 0v4a16 16 0 0 0 16 16a12 12 0 0 1 12 12M100 88a40 40 0 0 1-40 40a12 12 0 0 1 0-24a16 16 0 0 0 16-16v-4a12 12 0 0 1 24 0Z',
  'cloud-bold': 'M160 36a92.09 92.09 0 0 0-81 48.36A68 68 0 1 0 72 220h88a92 92 0 0 0 0-184m0 160H72a44 44 0 0 1-1.82-88A92 92 0 0 0 68 128a12 12 0 0 0 24 0a68 68 0 1 1 68 68',
  'terminal-window': 'M128 128a8 8 0 0 1-3 6.25l-40 32a8 8 0 1 1-10-12.5L107.19 128L75 102.25a8 8 0 1 1 10-12.5l40 32a8 8 0 0 1 3 6.25m48 24h-40a8 8 0 0 0 0 16h40a8 8 0 0 0 0-16m56-96v144a16 16 0 0 1-16 16H40a16 16 0 0 1-16-16V56a16 16 0 0 1 16-16h176a16 16 0 0 1 16 16m-16 144V56H40v144z',
  'magnifying-glass': 'm229.66 218.34l-50.07-50.06a88.11 88.11 0 1 0-11.31 11.31l50.06 50.07a8 8 0 0 0 11.32-11.32M40 112a72 72 0 1 1 72 72a72.08 72.08 0 0 1-72-72',
  'user-circle': 'M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24M74.08 197.5a64 64 0 0 1 107.84 0a87.83 87.83 0 0 1-107.84 0M96 120a32 32 0 1 1 32 32a32 32 0 0 1-32-32m97.76 66.41a79.66 79.66 0 0 0-36.06-28.75a48 48 0 1 0-59.4 0a79.66 79.66 0 0 0-36.06 28.75a88 88 0 1 1 131.52 0',
  'gear-six': 'M128 80a48 48 0 1 0 48 48a48.05 48.05 0 0 0-48-48m0 80a32 32 0 1 1 32-32a32 32 0 0 1-32 32m109.94-52.79a8 8 0 0 0-3.89-5.4l-29.83-17l-.12-33.62a8 8 0 0 0-2.83-6.08a111.9 111.9 0 0 0-36.72-20.67a8 8 0 0 0-6.46.59L128 41.85L97.88 25a8 8 0 0 0-6.47-.6a112.1 112.1 0 0 0-36.68 20.75a8 8 0 0 0-2.83 6.07l-.15 33.65l-29.83 17a8 8 0 0 0-3.89 5.4a106.5 106.5 0 0 0 0 41.56a8 8 0 0 0 3.89 5.4l29.83 17l.12 33.62a8 8 0 0 0 2.83 6.08a111.9 111.9 0 0 0 36.72 20.67a8 8 0 0 0 6.46-.59L128 214.15L158.12 231a7.9 7.9 0 0 0 3.9 1a8.1 8.1 0 0 0 2.57-.42a112.1 112.1 0 0 0 36.68-20.73a8 8 0 0 0 2.83-6.07l.15-33.65l29.83-17a8 8 0 0 0 3.89-5.4a106.5 106.5 0 0 0-.03-41.52m-15 34.91l-28.57 16.25a8 8 0 0 0-3 3c-.58 1-1.19 2.06-1.81 3.06a7.94 7.94 0 0 0-1.22 4.21l-.15 32.25a95.9 95.9 0 0 1-25.37 14.3L134 199.13a8 8 0 0 0-3.91-1h-3.83a8.1 8.1 0 0 0-4.1 1l-28.84 16.1A96 96 0 0 1 67.88 201l-.11-32.2a8 8 0 0 0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.1 8.1 0 0 0-3-3.06l-28.6-16.29a90.5 90.5 0 0 1 0-28.26l28.52-16.28a8 8 0 0 0 3-3c.58-1 1.19-2.06 1.81-3.06a7.94 7.94 0 0 0 1.22-4.21l.15-32.25a95.9 95.9 0 0 1 25.37-14.3L122 56.87a8 8 0 0 0 4.1 1h3.64a8.1 8.1 0 0 0 4.1-1l28.84-16.1A96 96 0 0 1 188.12 55l.11 32.2a8 8 0 0 0 1.22 4.22c.62 1 1.23 2 1.8 3.06a8.1 8.1 0 0 0 3 3.06l28.6 16.29a90.5 90.5 0 0 1 .05 28.29Z',
  'pencil-simple': 'm227.31 73.37l-44.68-44.69a16 16 0 0 0-22.63 0L36.69 152A15.86 15.86 0 0 0 32 163.31V208a16 16 0 0 0 16 16h44.69a15.86 15.86 0 0 0 11.31-4.69L227.31 96a16 16 0 0 0 0-22.63M92.69 208H48v-44.69l88-88L180.69 120ZM192 108.68L147.31 64l24-24L216 84.68Z',
  x: 'M205.66 194.34a8 8 0 0 1-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 0 1-11.32-11.32L116.69 128L50.34 61.66a8 8 0 0 1 11.32-11.32L128 116.69l66.34-66.35a8 8 0 0 1 11.32 11.32L139.31 128Z',
  warning: 'M236.8 188.09L149.35 36.22a24.76 24.76 0 0 0-42.7 0L19.2 188.09a23.51 23.51 0 0 0 0 23.72A24.35 24.35 0 0 0 40.55 224h174.9a24.35 24.35 0 0 0 21.33-12.19a23.51 23.51 0 0 0 .02-23.72m-13.87 15.71a8.5 8.5 0 0 1-7.48 4.2H40.55a8.5 8.5 0 0 1-7.48-4.2a7.59 7.59 0 0 1 0-7.72l87.45-151.87a8.75 8.75 0 0 1 15 0l87.45 151.87a7.59 7.59 0 0 1-.04 7.72M120 144v-40a8 8 0 0 1 16 0v40a8 8 0 0 1-16 0m20 36a12 12 0 1 1-12-12a12 12 0 0 1 12 12',
  play: 'M232.4 114.49L88.32 26.35a16 16 0 0 0-16.2-.3A15.86 15.86 0 0 0 64 39.87v176.26A15.94 15.94 0 0 0 80 232a16.07 16.07 0 0 0 8.36-2.35l144.04-88.14a15.81 15.81 0 0 0 0-27ZM80 215.94V40l143.83 88Z',
  pause: 'M200 32h-40a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176h-40V48h40ZM96 32H56a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176H56V48h40Z',
  'list-checks': 'M224 128a8 8 0 0 1-8 8h-88a8 8 0 0 1 0-16h88a8 8 0 0 1 8 8m-96-56h88a8 8 0 0 0 0-16h-88a8 8 0 0 0 0 16m88 112h-88a8 8 0 0 0 0 16h88a8 8 0 0 0 0-16M82.34 42.34L56 68.69L45.66 58.34a8 8 0 0 0-11.32 11.32l16 16a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0-11.32-11.32m0 64L56 132.69l-10.34-10.35a8 8 0 0 0-11.32 11.32l16 16a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0-11.32-11.32m0 64L56 196.69l-10.34-10.35a8 8 0 0 0-11.32 11.32l16 16a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0-11.32-11.32',
  'lock-simple': 'M208 80h-32V56a48 48 0 0 0-96 0v24H48a16 16 0 0 0-16 16v112a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V96a16 16 0 0 0-16-16M96 56a32 32 0 0 1 64 0v24H96Zm112 152H48V96h160z',
  key: 'M216.57 39.43a80 80 0 0 0-132.66 81.35L28.69 176A15.86 15.86 0 0 0 24 187.31V216a16 16 0 0 0 16 16h32a8 8 0 0 0 8-8v-16h16a8 8 0 0 0 8-8v-16h16a8 8 0 0 0 5.66-2.34l9.56-9.57A79.7 79.7 0 0 0 160 176h.1a80 80 0 0 0 56.47-136.57M224 98.1c-1.09 34.09-29.75 61.86-63.89 61.9H160a63.7 63.7 0 0 1-23.65-4.51a8 8 0 0 0-8.84 1.68L116.69 168H96a8 8 0 0 0-8 8v16H72a8 8 0 0 0-8 8v16H40v-28.69l58.83-58.82a8 8 0 0 0 1.68-8.84A63.7 63.7 0 0 1 96 95.92c0-34.14 27.81-62.8 61.9-63.89A64 64 0 0 1 224 98.1M192 76a12 12 0 1 1-12-12a12 12 0 0 1 12 12',
  clock: 'M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24m0 192a88 88 0 1 1 88-88a88.1 88.1 0 0 1-88 88m64-88a8 8 0 0 1-8 8h-56a8 8 0 0 1-8-8V72a8 8 0 0 1 16 0v48h48a8 8 0 0 1 8 8',
  'hard-drives': 'M208 136H48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16m0 64H48v-48h160zm0-160H48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16m0 64H48V56h160zm-16-24a12 12 0 1 1-12-12a12 12 0 0 1 12 12m0 96a12 12 0 1 1-12-12a12 12 0 0 1 12 12',
  books: 'm231.65 194.55l-33.19-157.8a16 16 0 0 0-19-12.39l-46.81 10.06a16.08 16.08 0 0 0-12.3 19l33.19 157.8A16 16 0 0 0 169.16 224a16.3 16.3 0 0 0 3.38-.36l46.81-10.06a16.09 16.09 0 0 0 12.3-19.03M136 50.15v-.09l46.8-10l3.33 15.87L139.33 66Zm6.62 31.47l46.82-10.05l3.34 15.9L146 97.53Zm6.64 31.57l46.82-10.06l13.3 63.24l-46.82 10.06ZM216 197.94l-46.8 10l-3.33-15.87l46.8-10.07l3.33 15.85zM104 32H56a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16M56 48h48v16H56Zm0 32h48v96H56Zm48 128H56v-16h48z',
  'calendar-blank': 'M208 32h-24v-8a8 8 0 0 0-16 0v8H88v-8a8 8 0 0 0-16 0v8H48a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16M72 48v8a8 8 0 0 0 16 0v-8h80v8a8 8 0 0 0 16 0v-8h24v32H48V48Zm136 160H48V96h160z',
  'arrows-clockwise': 'M228 48v48a12 12 0 0 1-12 12h-48a12 12 0 0 1 0-24h19l-7.8-7.8a75.55 75.55 0 0 0-53.32-22.26h-.43a75.5 75.5 0 0 0-53.06 21.63a12 12 0 1 1-16.78-17.16a99.38 99.38 0 0 1 69.87-28.47h.52a99.42 99.42 0 0 1 70.2 29.29L204 67V48a12 12 0 0 1 24 0m-44.39 132.43a75.5 75.5 0 0 1-53.09 21.63h-.43a75.55 75.55 0 0 1-53.32-22.26L69 172h19a12 12 0 0 0 0-24H40a12 12 0 0 0-12 12v48a12 12 0 0 0 24 0v-19l7.8 7.8a99.42 99.42 0 0 0 70.2 29.26h.56a99.38 99.38 0 0 0 69.87-28.47a12 12 0 0 0-16.78-17.16Z',
  'arrow-square-out': 'M224 104a8 8 0 0 1-16 0V59.32l-66.33 66.34a8 8 0 0 1-11.32-11.32L196.68 48H152a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Zm-40 24a8 8 0 0 0-8 8v72H48V80h72a8 8 0 0 0 0-16H48a16 16 0 0 0-16 16v128a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16v-72a8 8 0 0 0-8-8',
  'chat-circle-dots': 'M140 128a12 12 0 1 1-12-12a12 12 0 0 1 12 12m-56-12a12 12 0 1 0 12 12a12 12 0 0 0-12-12m88 0a12 12 0 1 0 12 12a12 12 0 0 0-12-12m60 12a104 104 0 0 1-152.88 91.82l-34.05 11.35a16 16 0 0 1-20.24-20.24l11.35-34.05A104 104 0 1 1 232 128m-16 0a88 88 0 1 0-164.19 44.06a8 8 0 0 1 .66 6.54L40 216l37.4-12.47a7.9 7.9 0 0 1 2.53-.42a8 8 0 0 1 4 1.08A88 88 0 0 0 216 128',
  tray: 'M208 32H48a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 16v104h-28.7a15.86 15.86 0 0 0-11.3 4.69L148.69 176h-41.38L88 156.69A15.86 15.86 0 0 0 76.69 152H48V48Zm0 160H48v-40h28.69L96 187.31a15.86 15.86 0 0 0 11.31 4.69h41.38a15.86 15.86 0 0 0 11.31-4.69L179.31 168H208z',
  cat: 'M96 140a12 12 0 1 1-12-12a12 12 0 0 1 12 12m76-12a12 12 0 1 0 12 12a12 12 0 0 0-12-12m60-80v88c0 52.93-46.65 96-104 96S24 188.93 24 136V48a16 16 0 0 1 27.31-11.31c.14.14.26.27.38.41L69 57a111.22 111.22 0 0 1 118.1 0l17.21-19.9c.12-.14.24-.27.38-.41A16 16 0 0 1 232 48m-16 0l-21.56 24.8a8 8 0 0 1-10.81 1.2A89 89 0 0 0 168 64.75V88a8 8 0 1 1-16 0V59.05a97.4 97.4 0 0 0-16-2.72V88a8 8 0 1 1-16 0V56.33a97.4 97.4 0 0 0-16 2.72V88a8 8 0 1 1-16 0V64.75A89 89 0 0 0 72.37 74a8 8 0 0 1-10.81-1.17L40 48v88c0 41.66 35.21 76 80 79.67v-20.36l-13.66-13.66a8 8 0 0 1 11.32-11.31L128 180.68l10.34-10.34a8 8 0 0 1 11.32 11.31L136 195.31v20.36c44.79-3.69 80-38 80-79.67Z',
  minus: 'M224 128a8 8 0 0 1-8 8H40a8 8 0 0 1 0-16h176a8 8 0 0 1 8 8',
  'arrow-up': 'M205.66 117.66a8 8 0 0 1-11.32 0L136 59.31V216a8 8 0 0 1-16 0V59.31l-58.34 58.35a8 8 0 0 1-11.32-11.32l72-72a8 8 0 0 1 11.32 0l72 72a8 8 0 0 1 0 11.32',
  'download-simple': 'M224 144v64a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8v-64a8 8 0 0 1 16 0v56h160v-56a8 8 0 0 1 16 0m-101.66 5.66a8 8 0 0 0 11.32 0l40-40a8 8 0 0 0-11.32-11.32L136 124.69V32a8 8 0 0 0-16 0v92.69L93.66 98.34a8 8 0 0 0-11.32 11.32Z',
  cube: 'm223.68 66.15l-88-48.15a15.88 15.88 0 0 0-15.36 0l-88 48.17a16 16 0 0 0-8.32 14v95.64a16 16 0 0 0 8.32 14l88 48.17a15.88 15.88 0 0 0 15.36 0l88-48.17a16 16 0 0 0 8.32-14V80.18a16 16 0 0 0-8.32-14.03M128 32l80.34 44L128 120L47.66 76ZM40 90l80 43.78v85.79l-80-43.75Zm96 129.57v-85.75L216 90v85.78Z',
};

export function icon(name, size = 14, style = '') {
  const body = ICONS[name];
  if (!body) throw new Error(`no icon ${name}`);
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" aria-hidden="true" style="flex:0 0 auto;display:block;${style}"><path fill="currentColor" d="${body}"></path></svg>`;
}

// Dark "Coven" palette v1.3 — resolved from src/styles/globals/foundations.css.
export const TOKENS = `
  --background: oklch(0.225 0.004 291);
  --foreground: oklch(0.985 0 0);
  --bg-panel: oklch(0.205 0.004 291);
  --bg-base: var(--background);
  --bg-raised: oklch(0.245 0.005 291);
  --bg-elevated: oklch(0.275 0.006 291);
  --bg-hover: oklch(0.305 0.007 291);
  --bg-subtle: color-mix(in oklch, var(--bg-raised) 72%, transparent);
  --bg-sunken: color-mix(in oklch, var(--bg-base) 88%, black);
  --muted: oklch(0.275 0.006 291);
  --text-primary: var(--foreground);
  --text-secondary: oklch(0.66 0.010 291);
  --text-muted: color-mix(in oklch, var(--foreground) 72%, transparent);
  --border-hairline: color-mix(in oklch, var(--foreground) 12%, transparent);
  --border-strong: color-mix(in oklch, var(--foreground) 48%, transparent);
  --accent-presence: #9386d0;
  --accent-presence-foreground: oklch(0.16 0.008 291);
  --accent-presence-hover: color-mix(in oklch, var(--accent-presence) 88%, white 12%);
  --color-success: oklch(0.78 0.14 158);
  --color-warning: oklch(0.83 0.13 78);
  --color-danger: oklch(0.74 0.18 24);
  --color-danger-soft: oklch(0.82 0.08 24);
  --ring-focus: color-mix(in oklch, var(--accent-presence) 55%, var(--foreground) 45%);
  --glass-elevated: color-mix(in oklch, var(--bg-elevated) 74%, transparent);
  --glass-raised: color-mix(in oklch, var(--bg-raised) 80%, transparent);
  --shell-floor: color-mix(in oklch, var(--bg-raised) 88%, var(--bg-panel));
  --radius-sm: 6px;
  --radius-control: 8px;
  --radius-card: 12px;
  --radius-panel: 16px;
  --radius-pill: 999px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --text-2xs: 10px; --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-md: 14px; --text-lg: 16px; --text-xl: 20px; --text-display: 28px;
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-serif: "EB Garamond", Georgia, "Times New Roman", serif;
  --rail-control: 32px; --rail-lead: 8px; --rail-pad: 4px;
`;

// Component classes copied from the app's stylesheets (values, not approximations).
export const COMPONENT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg-base); color: var(--text-primary); font-family: var(--font-sans); font-size: var(--text-base); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent-presence); text-decoration: none; } a:hover { color: var(--accent-presence-hover); }
  .mono { font-family: var(--font-mono); }
  .eyebrow { font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-secondary); }
  .caption { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.45; }

  /* shell */
  .shell-floor { background: var(--shell-floor); }
  .shell-nav { width: 240px; padding: var(--space-3) var(--space-2); display: flex; flex-direction: column; gap: var(--space-1); background: color-mix(in oklch, var(--bg-raised) 88%, transparent); margin: var(--space-2); border: 1px solid var(--border-hairline); border-radius: var(--radius-panel); box-shadow: 0 14px 36px -28px oklch(0 0 0); }
  .shell-nav--rail { width: 56px; margin: 0; border-radius: 0; border: 0; padding: var(--space-3) 0; align-items: center; }
  .rail-header { display: flex; flex-direction: column; gap: var(--space-1); padding: 0 var(--rail-pad); margin-bottom: var(--space-2); }
  .ctx-trigger { display: flex; align-items: center; width: 100%; min-height: var(--rail-control); gap: var(--space-2); padding: 0 calc(var(--rail-lead) - 1px); border-radius: var(--radius-control); border: 1px solid var(--border-strong); background: var(--bg-subtle); color: var(--text-primary); font-size: var(--text-base); font-weight: 500; text-align: left; cursor: pointer; }
  .ctx-trigger--crew { border-color: var(--border-hairline); font-weight: 600; }
  .ctx-trigger--open { background: var(--bg-hover); border-color: color-mix(in oklch, var(--accent-presence) 45%, var(--border-hairline)); }
  .ctx-trigger__label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctx-trigger__caret { color: var(--text-muted); }
  .rail-new { display: flex; align-items: center; width: 100%; gap: 10px; min-height: var(--rail-control); padding: 0 calc(var(--rail-lead) - 1px); border-radius: var(--radius-control); border: 1px solid color-mix(in oklch, var(--accent-presence) 24%, var(--border-hairline)); background: color-mix(in oklch, var(--accent-presence) 9%, transparent); color: var(--text-primary); font-size: var(--text-base); font-weight: 560; }
  .rail-new__icon { color: var(--text-secondary); }
  .rail-new__kbd { margin-left: auto; font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
  .nav-row { display: flex; align-items: center; gap: 10px; min-height: var(--rail-control); padding: 0 var(--rail-lead); border-radius: var(--radius-control); color: var(--text-secondary); font-size: var(--text-base); }
  .nav-row--active { background: color-mix(in oklch, var(--accent-presence) 12%, transparent); color: var(--text-primary); }
  .nav-row__count { margin-left: auto; font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }
  .nav-eyebrow { padding: var(--space-3) var(--rail-lead) var(--space-1); font-size: var(--text-2xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .rail-square { display: grid; place-items: center; width: var(--rail-control); height: var(--rail-control); border-radius: var(--radius-control); border: 1px solid var(--border-hairline); background: var(--bg-subtle); color: var(--text-secondary); }

  /* title bar */
  .menu-bar { display: flex; align-items: center; gap: var(--space-2); min-height: 36px; padding: 5px var(--space-3); background: var(--bg-base); font-size: var(--text-sm); }
  .titlebar-ctx { display: flex; align-items: center; gap: var(--space-1); padding-inline-start: var(--space-2); border-inline-start: 1px solid var(--border-hairline); }
  .titlebar-chip { display: inline-flex; align-items: center; gap: var(--space-1); height: 28px; padding: 0 var(--space-2); border-radius: var(--radius-control); border: 1px solid transparent; background: transparent; color: var(--text-primary); font-size: var(--text-sm); font-weight: 500; }
  .menu-search { display: flex; align-items: center; gap: var(--space-2); height: 26px; width: 300px; padding: 0 10px; border-radius: var(--radius-control); border: 1px solid var(--border-hairline); background: var(--bg-raised); color: var(--text-muted); font-size: var(--text-sm); }

  /* avatars */
  .project-avatar { --pa-size: 20px; width: var(--pa-size); height: var(--pa-size); flex: 0 0 var(--pa-size); border-radius: calc(var(--pa-size) * 0.29); display: grid; place-items: center; color: color-mix(in oklch, var(--tile, var(--accent-presence)) 65%, var(--text-primary)); background: color-mix(in oklch, var(--tile, var(--accent-presence)) 14%, transparent); border: 1px solid color-mix(in oklch, var(--tile, var(--accent-presence)) 24%, transparent); font-size: calc(var(--pa-size) * 0.375); font-weight: 700; line-height: 1; letter-spacing: -0.01em; }
  .fam { --fa: 16px; width: var(--fa); height: var(--fa); flex: 0 0 var(--fa); border-radius: 50%; display: grid; place-items: center; font-size: calc(var(--fa) * 0.42); font-weight: 700; color: var(--accent-presence-foreground); background: var(--tone, var(--accent-presence)); position: relative; }
  .fam__dot { position: absolute; right: -2px; bottom: -2px; width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 0 2px var(--bg-base); background: var(--color-success); }
  .all-glyph { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 5px; color: var(--accent-presence); background: color-mix(in oklch, var(--accent-presence) 16%, transparent); flex: 0 0 auto; }

  /* popover */
  .ui-popover { background: var(--glass-elevated); backdrop-filter: blur(20px) saturate(140%); border: 1px solid var(--border-strong); border-radius: var(--radius-control); box-shadow: 0 16px 40px oklch(0 0 0 / 45%); min-width: 180px; overflow: hidden; }
  .ui-popover-body { padding: 6px; }
  .ui-popover-label { font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 6px 10px 2px; }
  .ui-popover-item { display: flex; align-items: center; gap: var(--space-2); padding: 6px 10px; border-radius: var(--radius-sm); color: var(--text-primary); font-size: var(--text-sm); width: 100%; text-align: left; }
  .ui-popover-item--active { background: var(--bg-hover); }
  .ui-popover-item--muted { color: var(--text-muted); }
  .ui-popover-item__icon { color: var(--text-secondary); }
  .ui-popover-item__check { margin-left: auto; color: var(--text-primary); }
  .ui-popover-separator { height: 1px; background: var(--border-hairline); margin: var(--space-1) 0; }
  .picker-filter { width: calc(100% - 12px); margin: 6px 6px var(--space-1); padding: 5px var(--space-2); border: 1px solid var(--border-hairline); border-radius: var(--radius-control); background: transparent; color: var(--text-muted); font-size: var(--text-sm); }
  .picker-row { display: flex; align-items: center; gap: var(--space-2); padding: 6px 10px; border-radius: var(--radius-sm); }
  .picker-row--active { background: var(--bg-hover); }
  .picker-option { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
  .picker-heading { display: flex; align-items: center; gap: var(--space-2); min-width: 0; font-size: var(--text-sm); }
  .picker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
  .picker-access { flex: 0 0 auto; padding: 0 var(--space-1); border: 1px solid var(--border-hairline); border-radius: var(--radius-pill); background: color-mix(in oklch, var(--foreground) 6%, transparent); color: var(--text-secondary); font-size: var(--text-2xs); font-weight: 600; }
  .picker-root { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--text-secondary); }

  /* familiar switcher */
  .fs-header { display: flex; align-items: center; gap: var(--space-2); padding: 10px 10px 9px; border-bottom: 1px solid var(--border-hairline); background: color-mix(in oklch, var(--accent-presence) 5%, transparent); }
  .fs-header__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; flex: 1; }
  .fs-header__name { font-size: var(--text-base); font-weight: 650; color: var(--text-primary); }
  .fs-header__role { font-size: var(--text-xs); color: var(--text-muted); }
  .fs-edit { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2); border-radius: 7px; border: 1px solid var(--border-hairline); background: var(--bg-raised); color: var(--text-secondary); font-size: var(--text-xs); font-weight: 600; }
  .fs-list { display: flex; flex-direction: column; gap: 1px; padding: 6px; }
  .fs-option { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px var(--space-2); border-radius: var(--radius-control); color: var(--text-secondary); }
  .fs-option--active { background: color-mix(in oklch, var(--familiar-accent, var(--accent-presence)) 14%, transparent); color: var(--text-primary); }
  .fs-option--hover { background: var(--bg-hover); color: var(--text-primary); }
  .fs-checkbox { display: grid; place-items: center; width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--border-strong); color: var(--accent-presence-foreground); flex: 0 0 auto; }
  .fs-checkbox--checked { background: var(--accent-presence); border-color: var(--accent-presence); }
  .fs-checkbox--hidden { opacity: 0; }
  .fs-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-base); font-weight: 500; }
  .fs-meta { flex: 0 0 auto; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-2xs); color: var(--text-muted); }
  .fs-unread { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--color-warning); }

  /* buttons */
  .ui-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); height: 32px; padding: 0 var(--space-3); border-radius: var(--radius-control); border: 1px solid transparent; background: transparent; color: var(--text-primary); font-size: var(--text-sm); font-weight: 500; line-height: 1; white-space: nowrap; }
  .ui-btn--sm { height: 26px; padding: 0 10px; font-size: var(--text-xs); }
  .ui-btn--xs { height: 22px; padding: 0 var(--space-2); font-size: var(--text-xs); gap: 4px; }
  .ui-btn--primary { background: var(--accent-presence); border-color: var(--accent-presence); color: var(--accent-presence-foreground); }
  .ui-btn--secondary { background: var(--bg-raised); border-color: var(--border-strong); }
  .ui-btn--ghost { color: var(--text-secondary); }
  .ui-btn--danger-ghost { color: var(--color-danger-soft); }
  .ui-btn--full { width: 100%; justify-content: flex-start; }

  /* modal */
  .ui-modal-backdrop { background: oklch(0 0 0 / 60%); display: flex; align-items: center; justify-content: center; padding: var(--space-4); }
  .ui-modal { width: 100%; max-width: 560px; background: color-mix(in oklch, var(--bg-raised) 96%, transparent); border: 1px solid var(--border-hairline); border-radius: var(--radius-card); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px oklch(0 0 0 / 50%); }
  .ui-modal-header { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border-hairline); font-size: var(--text-base); color: var(--text-secondary); }
  .ui-modal-header strong { color: var(--text-primary); font-weight: 600; }
  .ui-modal-header__sep { color: var(--text-muted); }
  .ui-modal-close { margin-left: auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-secondary); }
  .ui-modal-body { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
  .ui-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-5); border-top: 1px solid var(--border-hairline); background: var(--bg-base); }

  /* fields */
  .ui-field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  .ui-field__label-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
  .ui-field__label { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
  .ui-field__optional { font-size: var(--text-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .ui-input { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding: 0 var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: var(--bg-base); color: var(--text-primary); font-size: var(--text-sm); }
  .ui-input--readonly { background: var(--bg-raised); color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--text-xs); }
  .ui-input__placeholder { color: var(--text-muted); }
  .ui-help { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.45; }
  .ui-error { font-size: var(--text-xs); color: var(--color-danger-soft); }

  /* template cards */
  .ui-template-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
  .ui-template-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-raised); text-align: left; }
  .ui-template-card--hover { background: var(--muted); border-color: var(--border-strong); }
  .ui-template-card-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--radius-control); background: var(--muted); color: var(--text-primary); }
  .ui-template-card-title { font-size: var(--text-base); font-weight: 600; }
  .ui-template-card-subtitle { font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.4; }

  /* chips */
  .ctx-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 13rem; height: 28px; padding: 0 var(--space-2); border: 1px solid transparent; border-radius: var(--radius-control); color: var(--text-secondary); font-size: var(--text-sm); font-weight: 450; }
  .ctx-chip__lead { color: var(--text-muted); display: inline-flex; }
  .ctx-chip__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctx-chip__chevron { color: var(--text-muted); opacity: 0.7; }
  .ctx-chip--override { max-width: none; border-color: color-mix(in oklch, var(--color-warning) 40%, var(--border-hairline)); background: color-mix(in oklch, var(--color-warning) 10%, transparent); color: var(--text-primary); }
  .host-chip { display: inline-flex; white-space: nowrap; flex: 0 0 auto; align-items: center; gap: 6px; height: 30px; padding: 0 11px; font-size: var(--text-xs); border: 1px solid var(--border-hairline); border-radius: var(--radius-pill); background: color-mix(in oklch, var(--bg-base) 50%, transparent); color: var(--text-secondary); }
  .host-chip svg { color: var(--accent-presence); }
  .host-chip__label { color: var(--text-muted); }
  .host-chip__value { color: var(--text-primary); font-weight: 600; }
  .host-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .host-dot--online { background: var(--color-success); } .host-dot--offline { background: var(--color-danger); } .host-dot--unknown { background: var(--text-muted); }
  .host-choice { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: 6px var(--space-2); border-radius: var(--radius-control); border: 1px solid transparent; color: var(--text-secondary); font-size: var(--text-sm); }
  .host-choice--selected { border-color: color-mix(in oklch, var(--accent-presence) 40%, transparent); background: color-mix(in oklch, var(--accent-presence) 12%, transparent); color: var(--text-primary); }
  .host-choice--connect { color: var(--text-muted); }
  .host-status { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .host-status--online { color: var(--color-success); } .host-status--offline { color: var(--color-danger); } .host-status--unknown { color: var(--text-muted); }
  .receipt { display: inline-flex; align-items: center; gap: var(--space-2); font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); padding-bottom: 2px; border-bottom: 1px solid color-mix(in oklch, var(--accent-presence) 55%, transparent); }
  .lifecycle { display: inline-flex; align-items: center; gap: 6px; height: 18px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--border-hairline); background: var(--bg-base); color: var(--text-secondary); font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.08em; line-height: 1; font-family: var(--font-mono); }
  .lifecycle--running { color: var(--text-primary); border-color: var(--border-strong); }

  /* chat chrome */
  .chat-context-row { display: flex; align-items: center; gap: var(--space-2); min-height: var(--space-8); padding: 0 var(--space-4); border-top: 1px solid var(--border-hairline); border-bottom: 1px solid var(--border-hairline); background: color-mix(in oklch, var(--foreground) 2%, transparent); font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-muted); }

  /* settings */
  .settings-rule { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
  .settings-rule__line { flex: 1 1 auto; height: 1px; background: var(--border-hairline); }
  .settings-desc { margin: 0 0 var(--space-2); color: var(--text-muted); font-size: var(--text-xs); }
  .settings-panel { border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-panel); overflow: hidden; }
  .settings-row { display: grid; grid-template-columns: minmax(160px, 220px) minmax(0, 1fr); align-items: center; gap: var(--space-6); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-hairline); }
  .settings-row:last-child { border-bottom: 0; }
  .settings-row__label { font-size: var(--text-sm); font-weight: 600; }
  .settings-row__hint { font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px; font-weight: 400; }
  .workspace-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); align-items: center; }
  .workspace-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: var(--space-8); border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: var(--bg-raised); padding: 0 var(--space-3); display: flex; align-items: center; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-primary); }
  .toggle { width: 34px; height: 20px; border-radius: var(--radius-pill); background: var(--accent-presence); position: relative; flex: none; }
  .toggle::after { content: ""; position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--accent-presence-foreground); }
  .toggle--off { background: var(--border-strong); } .toggle--off::after { right: auto; left: 2px; background: var(--text-primary); }

  /* summoning vessels */
  .summoning-vessels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
  .summoning-vessel { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); padding: var(--space-3); border: 1px dashed var(--border-strong); border-radius: var(--radius-card); background: color-mix(in oklch, var(--bg-elevated) 40%, transparent); text-align: left; }
  .summoning-vessel--active { border-style: solid; border-color: color-mix(in oklch, var(--accent-presence) 55%, var(--border-strong)); background: color-mix(in oklch, var(--accent-presence) 10%, transparent); }
  .summoning-vessel--expanded { grid-column: 1 / -1; }
  .summoning-vessel__icon { color: var(--accent-presence); }
  .summoning-vessel__title { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
  .summoning-vessel__hint { font-size: var(--text-2xs); line-height: 1.35; color: var(--text-muted); }
  .summoning-vessel--active .summoning-vessel__hint { color: var(--text-secondary); }
  .summoning-vessel__action { white-space: nowrap; margin-top: auto; font-size: var(--text-2xs); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-presence); }

  /* empty state */
  .ui-empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-2); padding: var(--space-5) var(--space-4); color: var(--text-secondary); }
  .ui-empty-state-icon { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: var(--radius-pill); background: color-mix(in oklch, var(--accent-presence) 12%, transparent); color: var(--accent-presence); }
  .ui-empty-state-headline { font-size: var(--text-md); font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
  .ui-empty-state-subtitle { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.6; }

  /* handoff labels drawn inside artboards */
  .spec-label { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
`;

export function page({ title, width, height, body, extraCss = '', bg = 'var(--bg-base)' }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;family=EB+Garamond:ital,wght@0,400;0,500;1,400&amp;display=swap">
  <style>
    :root { ${TOKENS} }
    ${COMPONENT_CSS}
    ${extraCss}
  </style>
</helmet>
<div style="width: ${width}px; height: ${height}px; background: ${bg}; overflow: hidden; position: relative;">
${body}
</div>
</x-dc>
</body>
</html>
`;
}
