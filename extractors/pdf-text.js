const PDFParser = require('pdf2json')

// Extract text from pdfs (WIP)

module.exports = function (data, { mimeType }, callback) {
  if (mimeType !== 'application/pdf') return callback()
  // TODO this needs testing - decide how much to take,
  // also would be better to use a stream and not parse the whole file - pdf2json can do this.
  const pdfParser = new PDFParser(this, 1)

  pdfParser.on('pdfParser_dataReady', pdfData => {
    callback(null, pdfParser.getRawTextContent())
  })
  pdfParser.parseBuffer(data)
}
