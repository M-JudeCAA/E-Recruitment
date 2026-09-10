// A real gutter on every side of every page. An earlier version drew one
// continuous image at full page width/height and simply shifted it up by
// a full pageHeight per page, relying on the PDF page boundary itself to
// "clip" the overflow - which left zero margin anywhere: content ran
// edge-to-edge on page 1's bottom edge and page 2+'s top/bottom edges,
// since nothing ever reserved that space. Fixed here by actually slicing
// the source canvas into per-page chunks sized to fit within the margin,
// and placing each chunk inside the margin box on its own page, rather
// than trusting an unclipped continuous image to land correctly.
//
// (A later attempt swapped this whole approach for jsPDF's built-in
// .html() renderer to also avoid splitting a sentence across a page
// break. That renderer clones the source into an iframe and does its own
// layout pass rather than capturing the DOM node actually on screen, and
// it broke badly in real use - reverted back to this known-working
// canvas-slicing version. The sentence-split problem still needs a real
// fix, but not at the cost of a renderer that hasn't been verified
// working at all.)
const TOP_MARGIN_PT = 72; // 1in (72pt per inch)
const SIDE_MARGIN_PT = 72; // 1in - left and right page margin
// The footer gets its OWN, larger bottom margin (1in) rather than sharing
// TOP_MARGIN_PT - FOOTER_MARGIN_PT is where its text baseline sits,
// exactly 1in up from the page's bottom edge. FOOTER_LINE_TO_TEXT_GAP_PT
// is the rule line's own offset above that baseline, and
// CONTENT_FOOTER_GAP_PT is the breathing room reserved between the
// content area and the footer's rule line, so content can never run into
// the footer.
const FOOTER_MARGIN_PT = 72; // 1in
const FOOTER_LINE_TO_TEXT_GAP_PT = 12;
const CONTENT_FOOTER_GAP_PT = 10;
const FOOTER_FONT_SIZE = 11;

// Draws the running footer (a thin rule, the advert's bold italic Times
// New Roman label on the left, "<page> | Page" in muted gray on the
// right) directly with jsPDF's own text/line API - real, crisp,
// selectable text, not part of the captured canvas image, and drawn once
// per page rather than being something the captured DOM could ever
// repeat on its own (the DOM has no idea where page breaks will land).
function drawFooter(pdf, pageWidth, pageHeight, footerLeft, pageNumber) {
  const textY = pageHeight - FOOTER_MARGIN_PT;
  const lineY = textY - FOOTER_LINE_TO_TEXT_GAP_PT;

  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.75);
  pdf.line(SIDE_MARGIN_PT, lineY, pageWidth - SIDE_MARGIN_PT, lineY);

  if (footerLeft) {
    pdf.setFont('times', 'bolditalic');
    pdf.setFontSize(FOOTER_FONT_SIZE);
    pdf.setTextColor(20, 20, 20);
    pdf.text(footerLeft, SIDE_MARGIN_PT, textY);
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(FOOTER_FONT_SIZE);
  pdf.setTextColor(140, 140, 140);
  pdf.text(`${pageNumber}  |  Page`, pageWidth - SIDE_MARGIN_PT, textY, { align: 'right' });
}

export async function downloadElementAsPdf(element, filename, { footerLeft } = {}) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas')
  ]);

  const canvas = await html2canvas(element, {
    scale: 2, // sharper text than the default 1:1 canvas resolution
    useCORS: true,
    backgroundColor: '#ffffff'
  });

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidthPt = pageWidth - SIDE_MARGIN_PT * 2;
  // Top edge starts at TOP_MARGIN_PT (0.5in); the bottom edge stops
  // CONTENT_FOOTER_GAP_PT short of the footer's own rule line, which
  // itself sits FOOTER_LINE_TO_TEXT_GAP_PT above the footer's 1in-from-
  // bottom text baseline - so content and the footer never overlap.
  const footerLineY = pageHeight - FOOTER_MARGIN_PT - FOOTER_LINE_TO_TEXT_GAP_PT;
  const contentBottomY = footerLineY - CONTENT_FOOTER_GAP_PT;
  const contentHeightPt = contentBottomY - TOP_MARGIN_PT;

  // How many source canvas pixels fit into one page's content band, given
  // the canvas is scaled down to contentWidthPt when drawn.
  const pxPerPoint = canvas.width / contentWidthPt;
  const pageHeightPx = Math.floor(contentHeightPt * pxPerPoint);

  let renderedPx = 0;
  let firstPage = true;
  let pageNumber = 1;

  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);

    // A fresh canvas per page, rather than redrawing the same full image
    // and hoping the page edge clips it in the right place - this is what
    // actually guarantees each page only ever contains its own slice,
    // leaving the margin band around it genuinely blank.
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    sliceCanvas.getContext('2d').drawImage(
      canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
    );

    if (!firstPage) pdf.addPage();
    pdf.addImage(
      sliceCanvas.toDataURL('image/png'), 'PNG',
      SIDE_MARGIN_PT, TOP_MARGIN_PT, contentWidthPt, sliceHeightPx / pxPerPoint
    );
    drawFooter(pdf, pageWidth, pageHeight, footerLeft, pageNumber);

    renderedPx += sliceHeightPx;
    firstPage = false;
    pageNumber++;
  }

  pdf.save(filename);
}

// A vacancy's jobRef ("UCAA/ADV/EXT/09/2026") contains characters that
// are invalid or awkward in a filename.
export function sanitizeFilenamePart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]+/g, '-');
}
