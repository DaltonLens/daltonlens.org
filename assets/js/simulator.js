import * as Comlink from "https://unpkg.com/comlink/dist/esm/comlink.mjs";

// The Comlink web worker object.
let pythonSimulator;

// Current image_url 
let currentImageDataURL;
let currentImageDataURL_without_metadata;

let cvdOptionBeforeMousedown;
let numFiltersStillProcessing = 0;

// Let's get those once for all.
const progressDiv = document.getElementById("Python-Progress")
const progressItem = document.getElementById("Python-Progress-Percent");
const progressText = document.getElementById("Python-Progress-Text");
const imageSection = document.getElementsByClassName("current-image")[0];
const currentImage = document.getElementById("img-current");
const severitySlider = document.getElementById("severity-slider");
const imageLoader = document.getElementById("img-loader");

// Temporary hidden canvas and image used to resize the input image and convert
// it to PNG.
const bufferCanvas = document.createElement("canvas");
const bufferImage = document.createElement("img");

// Store the output of filters that have already been applied.
let filterCache = {};

// https://stackoverflow.com/questions/44698967/requesting-blob-images-and-transforming-to-base64-with-fetch-api?noredirect=1&lq=1
// Download an image from the given URL and returns the data URL image/png;base64,data content.
function urlToDataUrl(url) {
    return fetch(url)
        .then(response => response.blob())
        .then(blob => new Promise(callback => {
            let reader = new FileReader();
            reader.onload = function () { callback(this.result) };
            reader.readAsDataURL(blob);
        }));
}

function showProgress(text, p) {
    // console.log("Progress: ", text);
    progressText.innerHTML = text;
    progressItem.style.width = `${p}%`;
}

// Callback that can be given to Comlink to get both the progress and a
// potential result when done
function cbWithProgress(cbWhenDone) {
    return Comlink.proxy(function(text, p, result = null) {
        showProgress (text, p);
        if (p == 100) {
            cbWhenDone(result);
        }
    })
}

async function startPyodide() { 

    console.log("Starting the pyodide worker.");
    const worker = new Worker("assets/js/simulator-worker.js");
    const PythonSimulator = Comlink.wrap(worker);
    pythonSimulator = await new PythonSimulator();
    pythonSimulator.init (cbWithProgress(function(r) {
        document.querySelectorAll('.Simulator').forEach(function (el) {
            el.style.display = 'block';
        });
        // setTimeout(function () {
        //     progressDiv.style.display = 'none';
        // }, 500);
    }));

    // Load a first image so it's not empty at the beginning.
    if (!currentImageDataURL) {
        urlToDataUrl('images/rgbspan.png').then(dataUri => updateWithImageURL(dataUri));
    }
}

function currentMethod() { return document.querySelector("input[name='method']:checked").value; }

function currentCVD() { return document.querySelector("input[name='cvd']:checked").value; }

function applyFilter() {
    const method = currentMethod();
    const cvd = currentCVD();
    
    if (cvd == 'none') {
        if (currentImageDataURL) {
            currentImage.src = currentImageDataURL;
        }
        return;
    }
    
    // Remove the first and last lines as they are just whitespaces.
    let python_code = document.getElementById(`${method}-code`).innerHTML;
    
    let updateImage = function(filtered_url) {
        currentImage.src = filtered_url;
        currentImage.style.filter = null;
        imageLoader.style.display = 'none';
        numFiltersStillProcessing -= 1;
        // Safety net in case something went wrong.
        if (numFiltersStillProcessing < 0)
            numFiltersStillProcessing = 0;
    };

    // If we already computed it, just return it.
    if (python_code in filterCache)
    {
        updateImage (filterCache[python_code]);
        return;
    }

    // Show the loader.
    currentImage.style.filter = 'blur(5px)';
    imageLoader.style.display = 'block';

    numFiltersStillProcessing += 1;
    pythonSimulator.applyFilter(python_code, cbWithProgress(function(filtered_url) {
        if (filtered_url) {
            filterCache[python_code] = filtered_url;
            updateImage(filtered_url);
        }
    }));
}

function updateWithImageURL(url) {
                    
    /*
        We only really need a Canvas if the image is too large.

        But it's also useful to convert from jpg or other image formats
        to png. On iOS we had wasm crashes with jpg images for example.

        Last, it'll be useful if we want to show color information at
        a given pixel one day.
    */
    bufferImage.onload = function() {
        const sourceWidth = bufferImage.naturalWidth;
        const sourceHeight = bufferImage.naturalHeight;

        const ctx = bufferCanvas.getContext("2d");

        if (sourceWidth > 1024) {
            document.getElementById('large-image-warning').style.display = 'block';
            bufferCanvas.width = 800;
            bufferCanvas.height = Math.round(800.0*sourceHeight/sourceWidth);
        }
        else {
            document.getElementById('large-image-warning').style.display = 'none';
            bufferCanvas.width = sourceWidth;
            bufferCanvas.height = sourceHeight;
        }

        // Actual resizing
        // https://imagekit.io/blog/how-to-resize-image-in-javascript/
        ctx.drawImage(bufferImage, 0, 0, bufferCanvas.width, bufferCanvas.height);

        // Show resized image in preview element
        currentImageDataURL = bufferCanvas.toDataURL('image/png');

        currentImage.src = currentImageDataURL;
        imageSection.style.display = 'block';
        // Remove the data:image/png;base64, header for Python
        currentImageDataURL_without_metadata = currentImageDataURL.substr(currentImageDataURL.indexOf(',') + 1);
        pythonSimulator.setImage (currentImageDataURL_without_metadata, cbWithProgress(function() {}));
        filterCache = {}
        updateCVDType();
    };

    // Will call onLoad when ready.
    bufferImage.src = url;
}

// As a global for the callbacks.
window.loadFile = function() {
    const file = document.querySelector('input[type=file]').files[0];
    const reader = new FileReader();

    showProgress("upload", 10);

    reader.onload = function(e) {
        updateWithImageURL (e.target.result);
    }

    if (file) {
        reader.readAsDataURL(file);            
    }
}

function setClassDisplay(className, display) {
    document.querySelectorAll(className).forEach(function (el) {
        el.style.display = display;
    });
}

function updateSimulationMethod() {
    setClassDisplay ('.method-description', 'none');

    const method = currentMethod();
    setClassDisplay (`.${method}-desc`, 'block');
    
    const cvd_to_show = currentCVD();
    // If the current CVD is none, then always show the code section
    // corresponding to the 'none' method.
    const method_for_cvd_code = (cvd_to_show == 'none') ? 'none' : method;
    const code_template = document.getElementById(`${method_for_cvd_code}-code-template`).innerHTML;
    const templates = {
        'deficiency': cvd_to_show.toUpperCase(),
        'severity': severitySlider.value / 10.0,
    }
    
    let code = code_template.replace(/#\{(.*?)\}/g, (match,id) => templates[id]);
    const lines = code.split(/\r?\n/);
    code = lines.slice(1,-1).join("\n");
    document.getElementById(`${method}-code`).innerHTML = code;
    applyFilter();
}

function updateCVDType () {
    setClassDisplay ('.cvd-description', 'none');
    const cvd_to_show = document.querySelector("input[name='cvd']:checked").value;
    setClassDisplay (`.${cvd_to_show}-desc`, 'block');

    updateSimulationMethod();
}

// https://youmightnotneedjquery.com/
function ready(fn) {
    if (document.readyState != 'loading'){
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
}

ready(function(){
    // Make sure that we create the objects.
    startPyodide();
        
    document.querySelectorAll("input[name='method']").forEach(function (el) {
        el.onchange = updateSimulationMethod;
    });

    document.querySelectorAll("input[name='cvd']").forEach(function (el) {
        el.onchange = updateCVDType;
    });

    updateSimulationMethod ();
    updateCVDType ();
    
    const img_current = document.getElementById('img-current');
    ['mousedown', 'touchstart'].forEach(function (evt) {
        img_current.addEventListener(evt, function () {
            if (numFiltersStillProcessing > 0) {
                return;
            }
            cvdOptionBeforeMousedown = document.querySelector("input[name='cvd']:checked");
            document.querySelector("input[name='cvd'][value='none']").checked = true;
            updateCVDType();
        },
            false);
    });

    ['mouseup', 'touchend'].forEach(function (evt) {
        img_current.addEventListener(evt, function () {
            if (!cvdOptionBeforeMousedown)
                return;
            cvdOptionBeforeMousedown.checked = true;
            updateCVDType();
        },
            false);
    });

    document.getElementById('predefined-images').onchange = function () {
        const url = this.value;
        urlToDataUrl(url).then(dataUri => updateWithImageURL(dataUri));            
    };

    document.getElementById('severity-slider').onchange = function () {
        updateSimulationMethod();
    };

});
