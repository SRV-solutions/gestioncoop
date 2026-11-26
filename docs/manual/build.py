"""Genera docs/CoopGestion-Manual.pdf a partir de index.html (manual) y contratapa.html.

Uso (desde la raíz del proyecto):  python docs/manual/build.py
Necesita Google Chrome y PyMuPDF (pip install pymupdf). La contratapa se imprime aparte y se une al final
porque Chrome pinta mal un cambio de página con márgenes distintos.
"""
import os
import subprocess
import tempfile

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'CoopGestion-Manual.pdf')
CHROME = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')


def print_pdf(html: str, pdf: str, profile: str) -> None:
    url = 'file:///' + os.path.join(HERE, html).replace('\\', '/').replace(' ', '%20')
    subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--user-data-dir={profile}',
         '--virtual-time-budget=10000', f'--print-to-pdf={pdf}', url],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


# Chrome puede tardar en soltar su carpeta de perfil: no frenar por eso al limpiar
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    body = os.path.join(tmp, 'manual.pdf')
    back = os.path.join(tmp, 'contratapa.pdf')
    print_pdf('index.html', body, os.path.join(tmp, 'perfil'))
    print_pdf('contratapa.html', back, os.path.join(tmp, 'perfil'))
    doc = pymupdf.open(body)
    with pymupdf.open(back) as b:
        doc.insert_pdf(b, from_page=0, to_page=0)
    doc.set_metadata({
        'title': 'CoopGestión — Manual de uso',
        'author': 'SRV',
        'subject': 'Cómo funciona CoopGestión, la plataforma de gestión para cooperativas de servicios',
        'creator': 'SRV · wearesrv.com',
        'producer': 'SRV · wearesrv.com',
    })
    doc.save(OUT, garbage=3, deflate=True)
    print(f'{OUT} ({doc.page_count} páginas)')
    doc.close()
