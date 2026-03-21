<div align="center">

<img src="assets/icons/chattering.png" width="80" height="80" alt="Chattering" />

# Chattering

**Multi-platform live chat viewer — Twitch · YouTube · TikTok**

[![Version](https://img.shields.io/badge/version-0.5.0--beta-9147ff?style=flat-square)](https://github.com/ofvvv/chattering2/releases)
[![Electron](https://img.shields.io/badge/electron-29-47848f?style=flat-square&logo=electron)](https://electronjs.org)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/ofvvv/chattering2/releases)

*Ver en tiempo real el chat de tus streams en vivo de Twitch, YouTube y TikTok desde una sola ventana*

</div>

---

## ✨ Características

| Función | Detalle |
|---|---|
| **Multi-plataforma** | Twitch, YouTube Live y TikTok Live simultáneamente |
| **Emotes** | Twitch nativos + 7TV, BTTV y FFZ |
| **Dock de eventos** | Follows, subs, regalos, bits, raids, likes, superchats |
| **Filtros** | Por plataforma, por rol (mod/VIP/sub) y por tipo de alerta |
| **TTS** | Texto a voz por plataforma con variación de tono/voz |
| **Moderación** | Ban, timeout, unban y borrar mensajes (solo Twitch, via Helix API) |
| **Usercard** | Historial de mensajes por usuario + acciones de moderación |
| **6 temas** | Oscuro, Claro, Gris, Gris Claro, Sakura, Midnight |
| **Auto-update** | Actualización automática desde GitHub Releases |
| **Dock flexible** | Arriba / Abajo / Izquierda / Derecha / Ventana flotante |

---

## 📦 Descargar

Descarga el instalador para tu sistema en la página de [**Releases**](https://github.com/ofvvv/chattering2/releases).

- **Windows**: `Chattering-Setup-0.5.0-beta.exe` (NSIS, te pregunta dónde instalar)
- **macOS**: `Chattering-0.5.0-beta.dmg`
- **Linux**: `Chattering-0.5.0-beta.AppImage`

---

## 🚀 Uso rápido

### 1. Twitch
1. Abre **Configuración** (⚙) → **Cuentas**
2. Haz clic en **Conectar con Twitch**
3. Autoriza la app en tu cuenta → la ventana se cierra sola
4. Al reiniciar, Twitch se auto-conecta a tu canal

### 2. YouTube
1. **Configuración → Cuentas → YouTube**
2. Escribe `@handle` o el ID del canal (`UCxxx...`)
3. Haz clic en **Conectar**

### 3. TikTok
1. **Configuración → Cuentas → TikTok**
2. Escribe el `@usuario` del live que quieres ver
3. Haz clic en **Conectar** (no necesita login para streams públicos)

---

## 🏗️ Arquitectura rápida

```
Main Process (Node.js)
├── src/connectors/   ← twitch.js · youtube.js · tiktok.js
├── src/ipc/          ← handlers.js (todos los ipcMain)
├── src/managers/     ← settings-manager.js · emote-manager.js
└── src/windows/
    ├── chat/         ← ventana principal del chat
    ├── settings/     ← configuración
    ├── dock/         ← dock de eventos (embed + float)
    └── usercard/     ← tarjeta de usuario

preload.js            ← bridge window.chattering.*
broadcast.js          ← IPC con targeting inteligente
```

Toda la comunicación entre procesos pasa por el bridge `window.chattering` (contextBridge). Los mensajes de chat solo van a la ventana de chat. Los status van a chat + settings. Esto minimiza el overhead de IPC en streams con mucho tráfico.

---

## 🛠️ Desarrollo

### Requisitos
- Node.js 18+
- npm 9+

### Instalar y correr

```bash
git clone https://github.com/ofvvv/chattering2.git
cd chattering2
npm install
npm run dev
```

### Compilar

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

> Antes de compilar, genera los íconos:
> ```bash
> npm install --save-dev sharp png2icons
> node scripts/convert-icons.js
> ```

---

## 📚 Dependencias principales

| Librería | Uso |
|---|---|
| [tmi.js](https://tmijs.com/) | Chat IRC de Twitch vía WebSocket |
| [youtube-chat](https://github.com/LinaTsukusu/youtube-chat) | Chat de YouTube Live |
| [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector) | Chat de TikTok Live vía WebSocket |
| [electron-updater](https://www.electron.build/auto-update) | Auto-actualización desde GitHub |
| [electron-store](https://github.com/sindresorhus/electron-store) | Persistencia de settings |

---

## ⚠️ Notas

- **Latencia Twitch**: ~500ms inherente al protocolo IRC/WebSocket (normal)
- **TikTok**: usa una API no oficial con límite de ~1000 req/día
- **Moderación**: solo funciona si tu cuenta es broadcaster o moderadora del canal

---

## 🤝 Contribuir

1. Abre un [issue](https://github.com/ofvvv/chattering2/issues) describiendo el bug o feature
2. Para PRs usa la rama `main` y describe claramente los cambios
3. **No modificar** los motores de chat de Twitch/YouTube sin indicarlo — están verificados

---

## 📄 Licencia

[MIT](LICENSE) © 2025 ofvvv