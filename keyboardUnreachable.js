///////////////////////////////////////////////////////////////////
// Searches for and fixes elements that are not keyboard reachable.
// Parses page JS for event handlers
// Tests if every element with a mouse event handler
// is keyboard reachable. If not, then it adds keyboard support for
// both evter and space (assumes everything may be a button),
// and gives a role of "button" if the element doesn't have any
// explict role defined.
////////////////////////////////////////////////////////////////////


// Counters
let inlineElementCtr = 0;

// Utils

function stripComments(code) {
    // Remove single-line comments
    code = code.replace(/\/\/.*$/gm, '');

    // Remove multi-line comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');

    return code;
}


function handleKbInteraction(event) {
    if (event.type === 'keydown' && (event.key === 'Enter' || event.key === 'Space')) {
        event.target.click();
    }
}

function selectElementByXPath(xpath) {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
}

function createStrippedPageElement() {
    // Create a new document fragment
    const fragment = document.createDocumentFragment();

    // Clone the current document's <html> element
    const strippedHtml = document.documentElement.cloneNode(true);

    // Remove all <script> elements from the cloned <html> element
    const scriptElements = strippedHtml.getElementsByTagName('script');
    while (scriptElements.length > 0) {
        scriptElements[0].parentNode.removeChild(scriptElements[0]);
    }

    // Append the stripped <html> element to the document fragment
    fragment.appendChild(strippedHtml);

    return fragment;
}

/****** from stack overflow *********
 * 
 * I've adapted the algorithm Chromium uses to calculate the XPath from devtools below.
 * To use this as-written you'd call Elements.DOMPath.xPath(<some DOM node>, false). 
 * The last parameter controls whether you get the shorter "Copy XPath" (if true) 
 * or "Copy full XPath".
 * 
 ************************************/

Elements = {};
Elements.DOMPath = {};

/**
 * @param {!Node} node
 * @param {boolean=} optimized
 * @return {string}
 */
Elements.DOMPath.xPath = function (node, optimized) {
    if (node.nodeType === Node.DOCUMENT_NODE) {
        return '/';
    }

    const steps = [];
    let contextNode = node;
    while (contextNode) {
        const step = Elements.DOMPath._xPathValue(contextNode, optimized);
        if (!step) {
            break;
        }  // Error - bail out early.
        steps.push(step);
        if (step.optimized) {
            break;
        }
        contextNode = contextNode.parentNode;
    }

    steps.reverse();
    return (steps.length && steps[0].optimized ? '' : '/') + steps.join('/');
};

/**
 * @param {!Node} node
 * @param {boolean=} optimized
 * @return {?Elements.DOMPath.Step}
 */
Elements.DOMPath._xPathValue = function (node, optimized) {
    let ownValue;
    const ownIndex = Elements.DOMPath._xPathIndex(node);
    if (ownIndex === -1) {
        return null;
    }  // Error.

    switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            if (optimized && node.getAttribute('id')) {
                return new Elements.DOMPath.Step('//*[@id="' + node.getAttribute('id') + '"]', true);
            }
            ownValue = node.localName;
            break;
        case Node.ATTRIBUTE_NODE:
            ownValue = '@' + node.nodeName;
            break;
        case Node.TEXT_NODE:
        case Node.CDATA_SECTION_NODE:
            ownValue = 'text()';
            break;
        case Node.PROCESSING_INSTRUCTION_NODE:
            ownValue = 'processing-instruction()';
            break;
        case Node.COMMENT_NODE:
            ownValue = 'comment()';
            break;
        case Node.DOCUMENT_NODE:
            ownValue = '';
            break;
        default:
            ownValue = '';
            break;
    }

    if (ownIndex > 0) {
        ownValue += '[' + ownIndex + ']';
    }

    return new Elements.DOMPath.Step(ownValue, node.nodeType === Node.DOCUMENT_NODE);
};

/**
 * @param {!Node} node
 * @return {number}
 */
Elements.DOMPath._xPathIndex = function (node) {
    // Returns -1 in case of error, 0 if no siblings matching the same expression,
    // <XPath index among the same expression-matching sibling nodes> otherwise.
    function areNodesSimilar(left, right) {
        if (left === right) {
            return true;
        }

        if (left.nodeType === Node.ELEMENT_NODE && right.nodeType === Node.ELEMENT_NODE) {
            return left.localName === right.localName;
        }

        if (left.nodeType === right.nodeType) {
            return true;
        }

        // XPath treats CDATA as text nodes.
        const leftType = left.nodeType === Node.CDATA_SECTION_NODE ? Node.TEXT_NODE : left.nodeType;
        const rightType = right.nodeType === Node.CDATA_SECTION_NODE ? Node.TEXT_NODE : right.nodeType;
        return leftType === rightType;
    }

    const siblings = node.parentNode ? node.parentNode.children : null;
    if (!siblings) {
        return 0;
    }  // Root node - no siblings.
    let hasSameNamedElements;
    for (let i = 0; i < siblings.length; ++i) {
        if (areNodesSimilar(node, siblings[i]) && siblings[i] !== node) {
            hasSameNamedElements = true;
            break;
        }
    }
    if (!hasSameNamedElements) {
        return 0;
    }
    let ownIndex = 1;  // XPath indices start with 1.
    for (let i = 0; i < siblings.length; ++i) {
        if (areNodesSimilar(node, siblings[i])) {
            if (siblings[i] === node) {
                return ownIndex;
            }
            ++ownIndex;
        }
    }
    return -1;  // An error occurred: |node| not found in parent's children.
};

/**
 * @unrestricted
 */
Elements.DOMPath.Step = class {
    /**
     * @param {string} value
     * @param {boolean} optimized
     */
    constructor(value, optimized) {
        this.value = value;
        this.optimized = optimized || false;
    }

    /**
     * @override
     * @return {string}
     */
    toString() {
        return this.value;
    }
};


//alert('Keyboard Unreachable Fix Starting');




async function getAssistantResponse(rqData) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(rqData, response => {
            if (response.error) {
                reject(response.error);
            } else {
                resolve(response.data);
            }
        });
    });
}

function parseJavaScriptString(jsString) {
    const elements = [];
    const variableMap = {};

    // Regular expression to match variable declarations
    const variableRegex = /(?:const|let|var)\s+(\w+)\s*=\s*document\.(?:getElementById|getElementsByClassName|querySelector)\(["'](.+?)["']\)/g;

    // Regular expression to match element.addEventListener() calls
    const addEventListenerRegex = /(\w+)\.addEventListener\(["'](\w+)["'],\s*function\s*\(.*?\)\s*{([\s\S]*?)}\)/g;

    // Regular expression to match inline event handlers
    const inlineEventRegex = /(\w+)\.on(\w+)\s*=\s*function\s*\(.*?\)\s*{([\s\S]*?)}/g;

    // Find variable declarations and store them in the variableMap
    let match;
    while ((match = variableRegex.exec(jsString)) !== null) {
        const variableName = match[1];
        const selector = getSelector(match[0]);
        if (selector !== 'window') {
            variableMap[variableName] = selector;
        }
    }

    // Find element.addEventListener() calls
    while ((match = addEventListenerRegex.exec(jsString)) !== null) {
        const variableName = match[1];
        const event = match[2];
        const actions = match[3].trim();
        const selector = variableMap[variableName] || variableName;
        if (selector !== 'window') {
            elements.push({ selector, event, actions });
        }
    }

    // Find inline event handlers
    while ((match = inlineEventRegex.exec(jsString)) !== null) {
        const variableName = match[1];
        const event = match[2];
        const actions = match[3].trim();
        const selector = variableMap[variableName] || variableName;
        if (selector !== 'window') {
            elements.push({ selector, event, actions });
        }
    }

    return elements;
}

// Helper function to determine the selector based on the element reference
function getSelector(elementRef) {
    if (elementRef.includes('getElementById')) {
        const id = elementRef.match(/document\.getElementById\(["'](.+?)['"]\)/)[1];
        return `#${id}`;
    } else if (elementRef.includes('getElementsByClassName')) {
        const className = elementRef.match(/document\.getElementsByClassName\(["'](.+?)['"]\)/)[1];
        return `.${className}`;
    } else if (elementRef.includes('querySelector')) {
        const selector = elementRef.match(/document\.querySelector\(["'](.+?)['"]\)/)[1];
        if (selector.startsWith('.')) {
            return selector;
        } else if (selector.startsWith('#')) {
            return selector;
        } else {
            return `.${selector}`;
        }
    } else {
        return elementRef;
    }
}


(async () => {
    try {

        ////////////////////////////////////////
        // First find all of the JS on the page
        // just the <script> tags
        ////////////////////////////////////////

        const scriptTags = document.querySelectorAll('script');
        let jsContent = '';
        scriptTags.forEach(tag => {
            jsContent += tag.textContent;
        });
        jsContent = stripComments(jsContent);

        // Element list is all event listeners including click and keydown
        const elementList = parseJavaScriptString(jsContent);

        //////////////////////////////////////////////////////////
        // Find the XPaths of elements referenced by handlersText
        //////////////////////////////////////////////////////////

        for (let element of elementList) {
            element.xpaths = new Array();
            const selector = element.selector;
            const refs = document.querySelectorAll(selector);
            refs.forEach(ref => {
                if (ref.tagName != 'BUTTON' && ref.tagName != 'button' && ref.tagName != 'A' && ref.tagName != 'a') {
                    const xpath = Elements.DOMPath.xPath(ref, false);
                    element.xpaths.push(xpath);
                }
            })
        }

        ///////////////////////////////////////////////////////////////////////////
        // Add in any DOM elements that use onclick() that are not <button> or <a>
        ///////////////////////////////////////////////////////////////////////////

        const elementsWithOnClick = document.querySelectorAll('[onclick]');
        for (let clickElement of elementsWithOnClick) {
            if (clickElement.tagName != 'BUTTON' && clickElement.tagName != 'button' && clickElement.tagName != 'A' && clickElement.tagName != 'a') {
                const xpath = Elements.DOMPath.xPath(clickElement, false);
                elementList.push({ "selector": "inline" + inlineElementCtr++, "event": "click", "xpaths": [xpath] });
            }

        }

        // At this point elementList is all the selectors that have event handlers

        const selectorsWithoutBothEvents = elementList
            .filter(item => item.selector)
            .filter(item => {
                const selectorItems = elementList.filter(i => i.selector === item.selector);
                return !(selectorItems.some(i => i.event === 'click') && selectorItems.some(i => i.event === 'keydown'));
            })
            .map(item => {
                return {
                    selector: item.selector,
                    event: item.event,
                    actions: item.actions,
                    xpaths: item.xpaths
                };
            });

        ///////////////////////////////////////////////////////////
        // Correct faulty elements that are not keyboard accessible
        ///////////////////////////////////////////////////////////

        for (let selWithoutBoth of selectorsWithoutBothEvents) {
            let elementAtPath;
            let xpath = 'none';
            if (selWithoutBoth.selector.startsWith('#')) {
                // ID
                elementAtPath = document.querySelector(selWithoutBoth.selector);
                if (elementAtPath.tagName !== 'BUTTON' && elementAtPath.tagName !== 'A') {
                    console.log('Fixing selector: ' + selWithoutBoth.selector);
                    elementAtPath.addEventListener('keydown', handleKbInteraction);
                    elementAtPath.tabIndex = 0; // Make the element focusable   
                }
            }
            else {
                // Class
                for (let xpath of selWithoutBoth.xpaths) {
                    elementAtPath = selectElementByXPath(xpath);
                    if (elementAtPath.tagName !== 'BUTTON' &&
                        elementAtPath.tagName !== 'A') {

                        console.log('Fixing selector: ' + selWithoutBoth.selector + ' xpath: ' + xpath);
                        elementAtPath.addEventListener('keydown', handleKbInteraction);
                        elementAtPath.tabIndex = 0; // Make the element focusable   
                    }

                }
            }
            if (elementAtPath === null) {
                console.log('Element is null, selector: ' + selWithoutBoth.selector + ', xpath: ' + xpath);
            }
            else {
                if (!elementAtPath.hasAttribute('role')) {
                    elementAtPath.setAttribute('role', 'button'); // force a button role
                }
            }
        }

        console.log('Page Ready!')

    } catch (error) {
        console.error('Error:', error);
    }
})();