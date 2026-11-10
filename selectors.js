// All WhatsApp Web DOM hooks live here. If WhatsApp changes its UI, fix this file.
// Verified against WhatsApp Web on 2026-11-10 (English UI).
// data-testid hooks are language-independent; aria-label hooks depend on the UI language,
// so each button accepts a list of labels (add your language's labels if needed).
var WA_SEL = {
  chatList: '#pane-side',
  chatRow: '[role="row"]',
  chatRowClickable: '[role="gridcell"][tabindex]',
  chatRowTitle: '[data-testid="cell-frame-title"] span[title]',
  searchInput: 'input[data-tab="3"]',

  headerTitle: '[data-testid="conversation-info-header-chat-title"]',
  headerInfoButton: '[data-testid="conversation-info-header-button"]',

  mediaLinksDocsEntry: '[data-testid="block-media-links-docs"]',
  galleryMediaTab: '[data-testid="gallery-tab-media"]',
  galleryGrid: '[data-testid="media-gallery"]',
  galleryItem: '[data-testid="media-gallery"] [data-testid="media-canvas"]',

  viewerModal: '[data-testid="media-viewer-modal"]',
  viewerLabels: {
    download: ['Download', 'Descargar', 'Baixar', 'Télécharger', 'Herunterladen'],
    previous: ['Previous', 'Anterior', 'Précédent', 'Zurück', 'Vorherige'],
    close: ['Close', 'Cerrar', 'Fechar', 'Fermer', 'Schließen']
  }
};
