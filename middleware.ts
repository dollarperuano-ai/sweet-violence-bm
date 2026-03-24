import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const ENABLE_SITE = true

export function middleware(request: NextRequest) {
  if (!ENABLE_SITE) {
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Sweet Violence BM — Offline</title>
        </head>
        <body style="
          margin:0;
          background:#0f1115;
          color:white;
          display:flex;
          align-items:center;
          justify-content:center;
          height:100vh;
          font-family:system-ui,sans-serif;
        ">
          <div style="text-align:center;">
            <h1 style="margin-bottom:12px;">Sweet Violence BM</h1>
            <p style="color:#9ca3af;">Sitio temporalmente fuera de servicio.</p>
          </div>
        </body>
      </html>
      `,
      {
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: "/:path*",
}