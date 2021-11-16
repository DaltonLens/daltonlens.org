importScripts("https://unpkg.com/comlink/dist/umd/comlink.js");
importScripts("https://cdn.jsdelivr.net/pyodide/v0.18.1/full/pyodide.js");

class PythonSimulator {    
    async doInit(progress) {

        progress("Pyodide", 5);
        this.pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.18.1/full/"
        });

        progress("micropip", 50);
        await this.pyodide.loadPackage("micropip");

        progress("DaltonLens", 60);
        await this.pyodide.runPython(`
            import micropip
            micropip.install('../python/daltonlens-0.1.5-py3-none-any.whl')
        `);

        progress("Pillow", 80);
        await this.pyodide.loadPackage("Pillow");

        progress("Common functions", 90);
        await this.pyodide.runPython(`
            import sys
            import numpy as np
            import io
            from base64 import b64decode, b64encode
            from PIL import Image
            from daltonlens import convert, simulate

            def load_image_from_js():
                from js import input_image_url
                return np.asarray(Image.open(io.BytesIO(b64decode(input_image_url))).convert('RGB'))

            def send_image_url_to_js(img):
                buffered = io.BytesIO()
                Image.fromarray(img).save(buffered, format="PNG")
                return 'data:image/png;base64,' + b64encode(buffered.getvalue()).decode('utf-8')
        `);

        progress("done", 100, "Empty Result");
    }

    async init(progress) {
        try {
            this.initCompletedPromise = this.doInit (progress);
            await this.initCompletedPromise;
        } catch (e) {
            progress("ERROR: Python init failed :-(", 100, null);
        }
    }

    async applyFilter(python_code, progress) {
        try {
            await this.initCompletedPromise;

            progress("applying filter", 30);
            await this.pyodide.runPython(`
image = original_image
${python_code}
            `);

            progress("transfer", 80);
            let im_url = await this.pyodide.runPython(`
send_image_url_to_js (filtered)
            `);
            progress("done", 100, im_url);
        } catch (e) {
            progress("ERROR: Python applyFilter failed :-(", 100, null);
        }
    }

    async setImage(image_url, progress) {
        try {
            await this.initCompletedPromise;
            self.input_image_url = image_url;
            progress("load image", 50);
            let im_url = await this.pyodide.runPython(`
                original_image = load_image_from_js()
            `);
            progress("done", 100, im_url);
        } catch (e) {
            console.log ('setImage failed: ' + e);
            progress("ERROR: Python setImage failed :-(", 100, null);
        }
    }

    async runPython(cb) {
        cb(0, "Starting");
        cb(100, "Done");
    }
}

Comlink.expose(PythonSimulator);
