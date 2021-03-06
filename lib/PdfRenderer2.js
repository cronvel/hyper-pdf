/*
	Meta PDF

	Copyright (c) 2018 Cédric Ronvel

	The MIT License (MIT)

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

"use strict" ;



var standardPageSizes = require( './standardPageSizes.js' ) ;
var standardFonts = require( './standardFonts.js' ) ;
var defaultStyles = require( './defaultStyles.js' ) ;

var fs = require( 'fs' ) ;
var PdfDocument = require( './PdfDocument' ) ;



function PdfRenderer( options = {} ) {
	this.htmlDoc = options.htmlDoc ;

	this.styles = Object.assign( {} , defaultStyles ) ;

	if ( options.styles ) {
		for ( let styleName in options.styles ) {
			if ( this.styles[ styleName ] ) {
				Object.assign( {} , this.styles[ styleName ] , options.styles[ styleName ] ) ;
			}
			else {
				this.styles[ styleName ] = options.styles[ styleName ] ;
			}
		}
	}
}

module.exports = PdfRenderer ;



PdfRenderer.prototype.render = function render( htmlDoc ) {
	htmlDoc = htmlDoc || this.htmlDoc ;

	var runtime = {
		pdfRenderer: this ,
		htmlDoc: htmlDoc ,
		pdfDoc: null ,
		pdfDocOptions: null ,
		fonts: standardFonts ,	// <-- TEMP!
		currentStyle: {} ,
		textAttributes: null ,
		styleStack: [ this.styles.root ] ,
		inline: false ,
		hasContent: false ,
		pageHasContent: false ,
		pendingPdfCommands: [] ,
		marginTop: 0 ,
		marginBottom: 0 ,
		paddingLeft: 0 ,
		paddingRight: 0 ,
		floatToY: 0 ,
		floatWidth: 0 ,
		floatSide: null ,
		inCaption: null
	} ;

	this.init( runtime ) ;

	renderNodes( runtime , htmlDoc.nodes ) ;

	// Finalize: exec pending pdf command
	flushPendingPdfCommands( runtime ) ;

	runtime.pdfDoc.end() ;
} ;



PdfRenderer.prototype.init = function init( runtime ) {
	var pageSize , pageStyle = this.styles.page ;

	if ( ! pageStyle.width || ! pageStyle.height ) {
		if ( typeof pageStyle.format !== 'string' || ! standardPageSizes[ pageStyle.format ] ) {
			throw new Error( "Unknown page format '" + pageStyle.format + "'." ) ;
		}

		pageSize = standardPageSizes[ pageStyle.format ] ;
	}
	else {
		pageSize = [ pageStyle.width , pageStyle.height ] ;
	}

	this.pdfDocOptions = {
		//autoFirstPage: false ,
		layout: pageStyle.layout ,
		size: pageSize ,
		margins: {
			top: pageStyle.marginTop ,
			bottom: pageStyle.marginBottom ,
			left: pageStyle.marginLeft ,
			right: pageStyle.marginRight
		}
	} ;

	runtime.pdfDoc = new PdfDocument( this.pdfDocOptions ) ;

	runtime.pdfDoc.on( 'pageAdded' , () => {
		onPageAdded( runtime ) ;
	} ) ;

	/*
	runtime.pdfDoc.on( 'lineWrap' , wrapper => {
		onLineWrap( runtime , wrapper ) ;
	} ) ;
	*/

	runtime.pdfDoc.pipe( fs.createWriteStream( 'test.pdf' ) ) ;
} ;



function onPageAdded( runtime ) {
	runtime.pageHasContent = false ;
	runtime.floatToY = 0 ;
	runtime.floatWidth = 0 ;
	runtime.floatSide = null ;
}



function renderNodes( runtime , nodes ) {

	nodes.forEach( node => {
		var fn = renderers[ node.type ] || renderers.default ;
		fn( runtime , node ) ;
	} ) ;
}



function renderTextStyle( runtime , style ) {
	var fontName , font ;

	if ( style === runtime.currentStyle ) { return ; }

	// Compute the font-ref: a built-in font string or a fs path to a font
	fontName = style.font || 'default' ;
	font = runtime.fonts[ fontName ] || runtime.fonts.default ;

	if ( style.bold ) {
		if ( style.italic ) {
			style.fontRef = font.boldItalic || font.bold || font.italic || font.normal ;
		}
		else {
			style.fontRef = font.bold || font.normal ;
		}
	}
	else if ( style.italic ) {
		style.fontRef = font.italic || font.normal ;
	}
	else {
		style.fontRef = font.normal ;
	}

	if ( style.fontRef !== runtime.currentStyle.fontRef ) {
		console.log( 'set fontRef to:' , style.fontRef ) ;
		runtime.pdfDoc.font( style.fontRef ) ;
	}

	if ( style.fontSize && style.fontSize !== runtime.currentStyle.fontSize ) {
		runtime.pdfDoc.fontSize( style.fontSize ) ;
	}

	// Text is rendered as a sort of SVG, it needs SVG styling
	renderSvgStyle( runtime , style , true ) ;

	runtime.currentStyle = style ;
}



function renderSvgStyle( runtime , style , slave ) {
	var fillColor , currentFillColor , strokeColor , currentStrokeColor ;

	if ( style === runtime.currentStyle ) { return ; }

	fillColor = style.fillColor || style.color || 'black' ;
	currentFillColor = runtime.currentStyle.fillColor || runtime.currentStyle.color || 'black' ;
	strokeColor = style.strokeColor || style.color || 'black' ;
	currentStrokeColor = runtime.currentStyle.strokeColor || runtime.currentStyle.color || 'black' ;

	if ( fillColor !== currentFillColor ) {
		runtime.pdfDoc.fill( fillColor ) ;
	}

	if ( strokeColor !== currentStrokeColor ) {
		runtime.pdfDoc.stroke( strokeColor ) ;
	}

	if ( ! slave ) {
		runtime.currentStyle = style ;
	}
}



// It delays most pdf commands to get more context
function renderPdf( runtime , data ) {
	prepareRenderPdf( runtime , data ) ;
	runtime.pendingPdfCommands.push( data ) ;
}



function prepareRenderPdf( runtime , data ) {
	switch ( data.type ) {
		case 'text' :
		case 'inlineImage' :
			if ( runtime.inline ) {
				if ( runtime.pendingPdfCommands.length ) {
					runtime.pendingPdfCommands[ runtime.pendingPdfCommands.length - 1 ].continued = true ;
					data.continuing = true ;
				}
			}
			else {
				data.newBlock = true ;
				data.marginTop = runtime.marginTop ;
				data.marginBottom = runtime.marginBottom ;
				runtime.marginTop = runtime.marginBottom = 0 ;
			}

			runtime.inline = true ;
			flushPendingPdfCommands( runtime ) ;
			break ;

		case 'blockImage' :
			data.marginTop = runtime.marginTop ;
			data.marginBottom = runtime.marginBottom ;
			flushPendingPdfCommands( runtime ) ;
			break ;
	}
}



function flushPendingPdfCommands( runtime ) {
	runtime.pendingPdfCommands.forEach( data => renderPdfNow( runtime , data ) ) ;
	runtime.pendingPdfCommands.length = 0 ;
}



function renderPdfNow( runtime , data ) {
	var size , position , attr , image , startingX , startingY , endingY , resumeToY ,
		//xBkup ,
		pdfDoc = runtime.pdfDoc ,
		lineHeight = pdfDoc._font.lineHeight( data.style.fontSize , true ) ;


	switch ( data.type ) {
		case 'text' :
			//console.log( "style: " , data.style ) ;
			attr = new TextAttributes( data.style , data.continued ) ;
			size = {
				width: null ,
				height: lineHeight
			} ;

			//console.log( "before:" , pdfDoc.y , "lineHeight:" , size.height ) ;

			if ( data.newBlock ) {
				sizeMarginPaddingPageBreak( runtime , data , size ) ;
				attr.width = size.maxWidth ;
			}

			renderTextStyle( runtime , data.style ) ;
			pdfDoc.text( data.text , attr ) ;
			runtime.hasContent = runtime.pageHasContent = true ;
			//console.log( "after:" , pdfDoc.y ) ;
			break ;

		case 'inlineImage' :
			//console.log( "style: " , data.style ) ;
			image = pdfDoc.openImage( data.path ) ;

			position = {} ;

			size = {
				width: image.width ,
				height: image.height ,
				lineHeight: lineHeight ,
				textHeight: pdfDoc._font.lineHeight( data.style.fontSize )
			} ;

			size.maxHeight = size.lineHeight * data.style.maxHeightEm ;

			if ( data.newBlock ) {
				sizeMarginPaddingPageBreak( runtime , data , size ) ;
			}

			inlineElementSizePositionWrap( runtime , data , size , position ) ;

			startingY = pdfDoc.y ;

			pdfDoc.image( image , position.x , position.y , size ) ;

			// Not needed anymore, because we fill the place with white chars:
			//if ( pdfDoc._wrapper ) { pdfDoc._wrapper.continuedX += size.boxWidth ; }

			pdfDoc.y = startingY ;

			runtime.hasContent = runtime.pageHasContent = true ;
			//console.log( "after:" , pdfDoc.y ) ;
			break ;

		case 'blockImage' :
			//console.log( "style: " , data.style ) ;
			image = pdfDoc.openImage( data.path ) ;

			size = {
				width: image.width ,
				height: image.height ,
				captionMaxHeight: data.captionStyle ? data.captionStyle.maxHeight + data.captionStyle.captionMargin : 0
			} ;

			//console.log( "before:" , pdfDoc.y , "imageHeight:" , size.height ) ;
			sizeMarginPaddingPageBreak( runtime , data , size ) ;
			//console.log( "\n\n >>>>>>>> image!" , pdfDoc.x , pdfDoc.y , "<<<<<<<<<<\n\n" ) ;

			//xBkup = pdfDoc.x ;

			startingX = pdfDoc.x ;
			startingY = pdfDoc.y ;
			endingY = startingY + size.boxHeight ;

			pdfDoc.image( image , pdfDoc.x , pdfDoc.y + data.style.paddingTop , size ) ;

			if ( data.float ) {
				resumeToY = startingY ;
				runtime.floatSide = data.float ;
				runtime.floatWidth = size.boxWidth ;
				runtime.floatToY = endingY ;

				// Why this is needed? It's a mystery...
				if ( ! data.captionStyle ) {
					runtime.floatToY += lineHeight ;
					resumeToY -= lineHeight ;
				}
			}
			else {
				resumeToY = startingY + size.boxHeight ;
			}

			if ( data.captionStyle ) {
				console.log( "\n\n\n>>>>> HAS CAPTION\n\n\n" ) ;

				if ( data.float ) {
					runtime.floatToY += data.captionStyle.captionMargin ;
				}
				else {
					resumeToY += data.captionStyle.captionMargin ;
				}

				runtime.inCaption = {
					float: data.float ,
					x: startingX ,
					y: endingY - data.style.paddingBottom + data.captionStyle.captionMargin ,
					width: size.width ,
					height: data.captionStyle.maxHeight ,
					resumeToY: resumeToY
				} ;

				// M.Y.S.T.E.R.Y.
				runtime.inCaption.y -= lineHeight ;
				runtime.floatToY -= lineHeight / 2 ;

				pdfDoc.y = runtime.inCaption.y ;
			}
			else {
				pdfDoc.y = resumeToY ;
			}

			runtime.hasContent = runtime.pageHasContent = true ;
			//console.log( "after:" , pdfDoc.y ) ;
			break ;
	}
}



function sizeMarginPaddingPageBreak( runtime , data , size ) {
	var yLimit , maxWidth , maxHeight , pageBreakBefore , rate ,
		pdfDoc = runtime.pdfDoc ,
		page = pdfDoc.page ;


	// First, manage width

	if ( runtime.inCaption ) {
		console.log( "\n\n\n>>>>> IN CAPTION\n\n\n" , runtime.inCaption ) ;
		size.xMin = runtime.inCaption.x ;
		size.maxWidth = runtime.inCaption.width ;
		size.xMax = size.xMin + size.maxWidth ;
	}
	else {
		size.xMin = page.margins.left + runtime.paddingLeft ;
		if ( runtime.floatSide === 'left' && pdfDoc.y < runtime.floatToY ) { size.xMin += runtime.floatWidth ; }

		size.xMax = page.width - page.margins.right - runtime.paddingRight ;
		if ( runtime.floatSide === 'right' && pdfDoc.y < runtime.floatToY ) { size.xMax -= runtime.floatWidth ; }

		size.maxWidth = size.xMax - size.xMin ;
	}


	if ( size.width ) {
		size.maxWidth -= data.style.paddingLeft + data.style.paddingRight ;
		maxWidth = Math.min( data.style.maxWidth , size.maxWidth ) ;

		if ( size.width > maxWidth ) {
			// Keep aspect ratio
			if ( size.height ) { size.height *= maxWidth / size.width ; }
			size.width = maxWidth ;
		}

		size.boxWidth = size.width + data.style.paddingLeft + data.style.paddingRight ;
	}

	if ( size.height ) {
		if ( size.maxHeight ) {
			size.maxHeight -= data.style.paddingTop + data.style.paddingBottom ;
			maxHeight = Math.min( data.style.maxHeight , size.maxHeight ) ;

			if ( size.height > maxHeight ) {
				// Keep aspect ratio
				if ( size.width ) { size.width *= maxHeight / size.height ; }
				size.height = maxHeight ;
			}
		}

		size.boxHeight = size.height + data.style.paddingTop + data.style.paddingBottom ;
	}


	// Then, manage vertical margins and page-break

	if ( ! runtime.pageHasContent ) {
		pdfDoc.y += data.style.leadingMarginTop !== undefined ? data.style.leadingMarginTop : data.marginTop ;
		pageBreakBefore = false ;
	}
	else if ( data.style.pageBreakBefore ) {
		pageBreakBefore = true ;
	}
	else {
		pdfDoc.y += Math.max( data.marginBottom , data.marginTop ) ;
		yLimit = page.height - page.margins.bottom - size.boxHeight - size.captionMaxHeight ;

		if ( data.style.unorphanHeight || data.style.unorphanHeight === 0 ) {
			// Here we assume that the block after a notOrphan block has:
			// * a marginTop lesser than the current marginBottom
			// * a size.height lesser than the current size.height
			yLimit -= data.style.marginBottom ;
			yLimit -= size.boxHeight ;
			yLimit -= data.style.unorphanHeight ;
		}

		//console.log( "\n>>> New block" , pdfDoc.y , yLimit , "<<<\n" ) ;

		if ( pdfDoc.y > yLimit ) {
			pageBreakBefore = true ;
		}
	}

	if ( pageBreakBefore ) {
		//console.log( "\n>>> Block needs/require a new page <<<\n" ) ;
		pdfDoc.addPage() ;

		// Don't forget to add the current marginTop
		pdfDoc.y += data.style.leadingMarginTop !== undefined ? data.style.leadingMarginTop : data.marginTop ;
		//console.log( "after new page:" , pdfDoc.y ) ;
	}


	// Finally, manage alignment and positioning

	if ( size.width ) {

		switch ( data.float || data.style.align ) {
			case 'left' :
				pdfDoc.x = size.xMin + data.style.paddingLeft ;
				break ;
			case 'right' :
				pdfDoc.x = size.xMax - size.width - data.style.paddingRight ;
				break ;
			case 'center' :
			case 'justify' :
			default :
				pdfDoc.x = size.xMin + ( size.maxWidth - size.width ) / 2 ;
				break ;
		}
	}
	else {
		pdfDoc.x = size.xMin ;
	}
}



function inlineElementSizePositionWrap( runtime , data , size , position ) {
	var whiteSpaceObj , extraPadding , interLine ,
		pdfDoc = runtime.pdfDoc ,
		page = pdfDoc.page ;

	var xMin = page.margins.left - runtime.paddingLeft ;
	if ( runtime.floatSide === 'left' && pdfDoc.y < runtime.floatToY ) { xMin += runtime.floatWidth ; }

	var xMax = page.width - page.margins.right - runtime.paddingRight ;
	if ( runtime.floatSide === 'right' && pdfDoc.y < runtime.floatToY ) { xMax -= runtime.floatWidth ; }

	if ( size.height > size.maxHeight ) {
		// Keep aspect ratio
		if ( size.width ) { size.width *= size.maxHeight / size.height ; }

		size.height = size.maxHeight ;
	}

	size.boxWidth = size.width + data.style.paddingLeft + data.style.paddingRight ;

	position.x = pdfDoc.x + data.style.paddingLeft ;

	if ( pdfDoc._wrapper ) {
		// Fill the text flow with white chars
		whiteSpaceObj = whiteSpaceWidth( pdfDoc , size.boxWidth ) ;
		pdfDoc.text( whiteSpaceObj.str , { continued: data.continued } ) ;
		extraPadding = ( whiteSpaceObj.width - size.boxWidth ) / 2 ;
		position.x = pdfDoc.x - whiteSpaceObj.width + data.style.paddingLeft + extraPadding ;

		// Check if there is still a wrapper...
		if ( pdfDoc._wrapper ) { position.x += pdfDoc._wrapper.continuedX ; }
	}

	interLine = ( size.lineHeight - size.textHeight ) / 2 ;
	position.y = pdfDoc.y + size.textHeight - interLine - size.height ;
}



function whiteSpaceWidth( pdfDoc , minWidth ) {
	var whiteChar , width , whiteStr = '' , whiteStrPlusSpaces ;

	whiteChar = '\u00a0' ;	// Non-breaking space
	//whiteChar = ' ' ;
	//whiteChar = '#' ;		// <-- test

	do {
		whiteStr += whiteChar ;
		whiteStrPlusSpaces = ' ' + whiteStr + ' ' ;
		width = pdfDoc.widthOfString( whiteStrPlusSpaces ) ;
	} while ( width < minWidth ) ;

	return { str: whiteStrPlusSpaces , width: width } ;
}



function createStyle( style , inherit ) {
	return Object.assign( {} , inherit , style || {} ) ;
}



function TextAttributes( style , continued ) {
	this.width = style.width || null ;
	this.height = style.height || null ;
	this.align = style.align || null ;
	this.lineBreak = style.lineBreak === undefined ? true : !! style.lineBreak ;
	this.underline = !! style.underline ;
	this.indent = style.indent || null ;
	this.fill = style.fill === undefined ? true : !! style.fill ;
	this.stroke = !! style.stroke ;
	this.link = style.link || null ;
	this.continued = !! continued ;
}



var renderers = {} ;



renderers._text = ( runtime , tag ) => {
	var style = runtime.styleStack[ runtime.styleStack.length - 1 ] ;

	renderPdf( runtime , {
		type: 'text' ,
		text: tag.text ,
		style: style
	} ) ;
} ;



var tagStyles = {
	i: "italic" ,
	em: "italic" ,
	b: "bold" ,
	strong: "bold" ,
	u: "underline" ,
	a: "link" ,
	p: "paragraph" ,
	h1: "heading1" ,
	h2: "heading2" ,
	h3: "heading3" ,
	h4: "heading4" ,
	h5: "heading5" ,
	h6: "heading6" ,
	ul: "list" ,
	li: "listItem" ,
	img: "inlineImage" ,
	figcaption: "caption"
} ;


function getStyle( runtime , tag , overrideStyleName ) {
	var styleName = overrideStyleName || tagStyles[ tag.type ] || tag.type ;
	var bareStyle = runtime.pdfRenderer.styles[ styleName ] || {} ;
	return createStyle( bareStyle , runtime.styleStack[ runtime.styleStack.length - 1 ] ) ;
}



function commonInlineStyleTag( runtime , tag , hooks ) {
	var style = getStyle( runtime , tag ) ;

	runtime.styleStack.push( style ) ;

	if ( hooks && hooks.beforeInner ) {
		hooks.beforeInner( runtime , tag , style ) ;
	}

	renderNodes( runtime , tag.children ) ;

	if ( hooks && hooks.afterInner ) {
		hooks.afterInner( runtime , tag , style ) ;
	}

	runtime.styleStack.length -- ;
}



function commonBlockStyleTag( runtime , tag , hooks ) {
	var style = getStyle( runtime , tag ) ;

	openBlock( runtime , tag , style ) ;

	// Should be done when entering a block element
	runtime.inline = false ;
	runtime.styleStack.push( style ) ;

	if ( hooks && hooks.beforeInner ) {
		hooks.beforeInner( runtime , tag , style ) ;
	}

	renderNodes( runtime , tag.children ) ;

	if ( hooks && hooks.afterInner ) {
		hooks.afterInner( runtime , tag , style ) ;
	}

	closeBlock( runtime , tag , style ) ;

	// Should be done when closing a block element too
	runtime.inline = false ;
	runtime.styleStack.length -- ;
}



function openBlock( runtime , tag , style ) {
	if ( style.marginTop > runtime.marginTop ) {
		runtime.marginTop = style.marginTop ;
	}

	// Add the padding
	runtime.paddingLeft += style.paddingLeft ;
	runtime.paddingRight += style.paddingRight ;
}



function closeBlock( runtime , tag , style ) {
	if ( style.marginBottom > runtime.marginBottom ) {
		runtime.marginBottom = style.marginBottom ;
	}

	// Remove the padding
	runtime.paddingLeft -= style.paddingLeft ;
	runtime.paddingRight -= style.paddingRight ;
}



renderers.i =
renderers.em =
renderers.u =
renderers.b =
renderers.strong =
	commonInlineStyleTag ;



renderers.a = function listItem( runtime , tag ) {
	commonInlineStyleTag( runtime , tag , {

		beforeInner: ( runtime_ , tag_ , style ) => {
			if ( tag_.attributes.href ) {
				style.link = tag_.attributes.href ;
			}
		}
	} ) ;
} ;



renderers.img = function img( runtime , tag ) {
	var style = getStyle( runtime , tag ) ;

	renderPdf( runtime , {
		type: 'inlineImage' ,
		path: tag.attributes.src ,
		style: style
	} ) ;
} ;



renderers.p =
renderers.h1 =
renderers.h2 =
renderers.h3 =
renderers.h4 =
renderers.h5 =
renderers.h6 =
renderers.ul =
	commonBlockStyleTag ;



renderers.li = function listItem( runtime , tag ) {
	commonBlockStyleTag( runtime , tag , {

		beforeInner: ( runtime_ , tag_ , style ) => {
			if ( style.listItemPrefix ) {
				renderPdf( runtime , {
					type: 'text' ,
					text: style.listItemPrefix ,
					style: style
				} ) ;
			}
		}
	} ) ;
} ;



renderers.figure = function figure( runtime , tag ) {
	var imgTag , imgStyle , captionTag , captionStyle , overrideStyleName , float = null ,
		captionRealHeight ,
		pdfDoc = runtime.pdfDoc ;

	imgTag = tag.children.find( tag_ => tag_.type === 'img' ) ;

	// If there isn't any image tag, return now...
	if ( ! imgTag ) { return ; }

	if ( tag.classes.float ) {
		if ( tag.classes['float-right'] ) {
			// Change the type to rightFloatingImg
			overrideStyleName = 'rightFloatingImage' ;
			float = 'right' ;
		}
		else {
			// Change the type to leftFloatingImg
			overrideStyleName = 'leftFloatingImage' ;
			float = 'left' ;
		}
	}
	else {
		overrideStyleName = 'blockImage' ;
	}

	imgStyle = getStyle( runtime , imgTag , overrideStyleName ) ;

	// Get a non-empty caption tag
	captionTag = tag.children.find( tag_ => tag_.type === 'figcaption' && tag_.children.length ) ;

	if ( captionTag ) {
		captionStyle = getStyle( runtime , captionTag ) ;
	}

	openBlock( runtime , tag , imgStyle ) ;

	renderPdf( runtime , {
		type: 'blockImage' ,
		path: imgTag.attributes.src ,
		style: imgStyle ,
		captionStyle: captionStyle ,
		float: float
	} ) ;

	if ( captionTag ) {
		flushPendingPdfCommands( runtime ) ;
		console.log( "runtime.inCaption" , runtime.inCaption ) ;
		commonBlockStyleTag( runtime , captionTag ) ;
		flushPendingPdfCommands( runtime ) ;

		captionRealHeight = pdfDoc.y - runtime.inCaption.y ;
		console.log( "captionRealHeight:" , captionRealHeight ) ;

		if ( runtime.floatSide ) {
			runtime.floatToY += captionRealHeight ;
		}
		else {
			runtime.inCaption.resumeToY += captionRealHeight ;
		}

		pdfDoc.y = runtime.inCaption.resumeToY ;
		runtime.inCaption = null ;
	}

	closeBlock( runtime , tag , imgStyle ) ;

	runtime.inline = false ;
} ;



// Unknown tag... return nothing or render its content?
renderers.default = ( runtime , tag ) => {
	console.error( 'Unsupported tag' , tag.type ) ;

	//return '' ;
	return {
		text: renderNodes( runtime , tag.children )
	} ;
} ;


