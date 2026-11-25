# Terminal web

Terminal en el navegador para conectarse por SSH a tus servidores. Corre en tu propia máquina y usa el `ssh` del sistema, así que respeta tus llaves, tu agente y tu `~/.ssh/config`.

- Lista los servidores de `~/.ssh/config` y conecta con un clic.
- Conexión manual a `usuario@host[:puerto]`.
- Varias sesiones a la vez, cada una en su pestaña.
- Terminal local de la máquina donde corre.

## Requisitos

- Linux o macOS.
- Node.js 18 o superior.
- Cliente OpenSSH (`ssh`) instalado.
- Herramientas de compilación, porque `node-pty` se compila al instalar:
  - Debian/Ubuntu: `sudo apt install build-essential python3`
  - macOS: `xcode-select --install`

## Instalación

```bash
git clone https://github.com/JorgeHplus/terminalweb.git
cd terminalweb
npm install
```

## Ejecución

```bash
npm start
```

La consola muestra una URL con token, parecida a esta:

```
http://127.0.0.1:7681/?token=...
```

Ábrela en el navegador. El token se guarda en una cookie, así que después basta con entrar a `http://127.0.0.1:7681`.

Para detener el servidor: `Ctrl+C`.

### Cambiar el puerto

El puerto por defecto es `7681`. Para usar otro:

```bash
PORT=7682 npm start
```

## Uso

| Quiero... | Cómo |
|---|---|
| Conectarme a un servidor de mi `~/.ssh/config` | Clic en el servidor de la lista lateral. |
| Buscar un servidor | Escribir en el campo **Filtrar**. |
| Conectarme a un servidor que no está en la lista | Escribir `usuario@host` o `usuario@host:puerto` y pulsar **Conectar**. |
| Abrir una terminal de mi propia máquina | Botón **+ Terminal local**. |
| Tener varias sesiones | Cada conexión abre una pestaña; clic en la pestaña para cambiar. |
| Cerrar una sesión | La `×` de la pestaña, o escribir `exit`. |
| Recargar la lista tras editar `~/.ssh/config` | Botón **↻**. |

La contraseña o la frase de la llave, si el servidor la pide, se escribe en la misma terminal, igual que con `ssh` normal.

### Agregar un servidor a la lista

La lista sale de `~/.ssh/config`. Ejemplo de entrada:

```
Host mi-servidor
    HostName 203.0.113.10
    User root
    Port 22
    IdentityFile ~/.ssh/id_ed25519
```

No se muestran las entradas con comodines (`*`, `?`) ni las que vienen de archivos `Include`.

## Seguridad

Quien entra a esta página puede ejecutar comandos como tu usuario, por eso:

- El servidor escucha solo en `127.0.0.1`: no es accesible desde la red.
- Pide un token, guardado en el archivo `.token` (permisos `600`, fuera de git).
- Rechaza peticiones de otros sitios web (revisa `Origin` y `Host`).
- El destino SSH se valida para que no se puedan inyectar opciones de `ssh`.

No lo expongas a internet ni lo pongas detrás de un proxy público tal como está: no tiene usuarios, HTTPS ni registro de accesos.

Para generar un token nuevo, borra `.token` y reinicia el servidor.

## Problemas comunes

| Mensaje | Causa y solución |
|---|---|
| `El puerto 7681 ya esta en uso` | Ya hay una copia corriendo. Ciérrala o usa otro puerto con `PORT=7682 npm start`. |
| `Sin acceso. Abre la URL con token...` | El navegador no tiene la cookie. Abre la URL completa con token que muestra la consola. |
| `Token incorrecto` | El token de la URL es antiguo. Copia la URL nueva de la consola. |
| Error al hacer `npm install` | Faltan las herramientas de compilación. Revisa **Requisitos**. |
| `[sesión cerrada]` apenas conecta | `ssh` falló (host, llave o red). El motivo aparece justo arriba en la terminal. |

## Estructura

```
server.js          Servidor HTTP + WebSocket; abre una terminal (pty) por sesión
public/index.html  Página
public/app.js      Pestañas, lista de servidores y conexión con xterm.js
public/style.css   Estilos
```

Dependencias: [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty) y [ws](https://github.com/websockets/ws).
