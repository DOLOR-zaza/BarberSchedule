# ⚡ Workflow de n8n — Notificaciones de BarberSchedule

Este directorio contiene el workflow de **n8n** que se dispara cada vez
que ocurre algo con una cita en BarberSchedule.

## ¿Qué hace?

Cuando el frontend de Angular detecta un evento (cita creada, confirmada,
cancelada, etc.), manda un POST al webhook de n8n. Este workflow
ejecuta en paralelo:

- 📱 **WhatsApp** al cliente (vía WATI o Twilio)
- 📧 **Email** al cliente y al barbero asignado (vía SendGrid o Gmail)

## 📦 Archivos

| Archivo | Para qué |
|---|---|
| `barberschedule-notifications.json` | Workflow completo. **Importar este archivo** en n8n. |
| `README.md` | Este archivo, instrucciones de setup. |

## 🚀 Setup en 5 minutos

### 1. Instala n8n

**Opción A — Cloud (gratis para empezar):**
- Ve a https://n8n.cloud y crea cuenta
- Tienen tier gratis con workflows ilimitados

**Opción B — Local con Docker:**
```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```

Luego abre http://localhost:5678

### 2. Importa el workflow

1. En n8n, click en **Workflows** → **Import from File**
2. Selecciona `barberschedule-notifications.json`
3. Se crea el workflow con todos los nodos

### 3. Configura las credenciales

El workflow tiene 3 nodos que necesitan credenciales:

| Nodo | Servicio | Cómo configurarlo |
|---|---|---|
| **WATI / Twilio** | WhatsApp | API key de WATI o Twilio |
| **SendGrid / Gmail** | Email | API key o OAuth de Gmail |
| (Opcional) **Barbers API** | n8n → json-server | URL: `http://host.docker.internal:3001` si json-server está en tu máquina |

#### Para WATI (WhatsApp):
1. Crea cuenta en https://wati.io
2. Ve a **API** → copia el **Endpoint** y el **Access Token**
3. En n8n, crea credencial "WATI API" con esos valores

#### Para Gmail (gratis):
1. En n8n, nodo Gmail → **Connect my account** → OAuth
2. Sigue los pasos de Google

#### Para SendGrid (alternativa email profesional):
1. Crea API key en https://sendgrid.com
2. En n8n, credencial "SendGrid" → pega API key

### 4. Activa el workflow

1. Click en el toggle **Active** arriba a la derecha
2. Copia la URL del webhook (click en el nodo Webhook → "Test URL" o "Production URL")
3. Pega esa URL en `/gestion` del frontend, en el campo "Webhook URL"
4. Cambia el modo de **DEMO** a **LIVE** en el panel de n8n

## 🧪 Modo DEMO (sin enviar nada real)

Por default, el frontend está en **modo DEMO**. Esto significa:
- No hace POST real a n8n
- Solo loguea en la consola del navegador
- Muestra la notificación en el panel admin

Útil para:
- Desarrollo local sin n8n instalado
- Demos de universidad (no quieres enviar WhatsApp reales en vivo)
- Testing sin gastar créditos de WATI/Twilio

## 📊 Payload que recibe n8n

```json
{
  "event": "created" | "updated" | "deleted" | "confirmed" | "cancelled" | "attended",
  "timestamp": "2026-06-15T10:30:00.000Z",
  "appointment": {
    "id": 1,
    "clientName": "Juan Pérez",
    "phone": "555-0101",
    "serviceId": 1,
    "barberId": 1,
    "date": "2026-06-15",
    "time": "10:00",
    "status": "pendiente",
    "notes": "Cliente regular"
  },
  "metadata": {
    "previousStatus": "pendiente",
    "triggeredBy": "client" | "admin"
  }
}
```

## 🎨 Mensajes que se envían

### WhatsApp (al cliente):

**Cita creada:**
```
¡Hola Juan! 👋

Tu cita en BarberSchedule está confirmada:
📅 15-Jun-2026
⏰ 10:00
✂️ Servicio: Corte clásico
💈 Barbero: Carlos

Te esperamos puntualmente. Si necesitas cambiar algo,
contáctanos con anticipación.

— BarberSchedule 💈
```

**Cita cancelada:**
```
Hola Juan, lamentamos informarte que tu cita del 15-Jun
a las 10:00 ha sido cancelada. 

Si quieres reagendar, entra a la app o contáctanos.
— BarberSchedule
```

### Email (al barbero asignado):

**Asunto:** `Nueva cita asignada — Juan Pérez, 15-Jun 10:00`

```
Hola Carlos,

Tienes una nueva cita:
Cliente: Juan Pérez (555-0101)
Fecha: 15-Jun-2026
Hora: 10:00
Servicio: Corte clásico
Notas: Cliente regular

Prepárate. 💈
— BarberSchedule
```

## 🔄 Para personalizar

Edita los nodos en n8n visualmente:
- Cambia el texto del mensaje de WhatsApp
- Agrega más notificaciones (Slack, Discord, SMS)
- Añade un nodo de Google Calendar para crear eventos
- Conecta a un CRM para guardar el lead

Todo se hace con drag & drop en el canvas de n8n, sin código.

## ❓ Troubleshooting

**El webhook no se dispara:**
- Verifica que el modo en /gestion esté en "LIVE"
- Verifica que la URL del webhook sea la correcta
- Revisa la consola del navegador por errores
- Revisa los "Executions" en n8n

**WhatsApp no llega:**
- WATI requiere que el número destino esté registrado
- Revisa que el formato del teléfono sea correcto (con código de país)
- En sandbox de Twilio solo puedes enviar a números verificados

**Email no llega:**
- Revisa spam
- Para Gmail, asegúrate de haber dado permisos de "Send mail"
- SendGrid tiene tier gratis de 100 emails/día
