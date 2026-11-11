// Source raster sampling requirements for native DOCX transparency capture.
// Xpdf owns PDF interpretation; this output device only observes image callbacks.
#ifndef C2S_PDF_CAPTURE_RASTER_DENSITY_H
#define C2S_PDF_CAPTURE_RASTER_DENSITY_H
#include <algorithm>
#include <cmath>
#include <vector>
#include "../lib/xpdf/Object.h"
#include "../lib/xpdf/OutputDev.h"
#include "../lib/xpdf/GfxState.h"
#include "../lib/xpdf/Annot.h"
namespace PdfReader { namespace DocxCapture {
class RasterDensity : public OutputDev
{
    bool mask = false, delegating = false;
    unsigned int groupDepth = 0, images = 0;
    std::vector<bool> masks;
    class ImageScope
    {
        bool& value; bool previous;
    public:
        explicit ImageScope(bool& flag) : value(flag), previous(flag) { value = true; }
        ~ImageScope() { value = previous; }
    };
    void Image(GfxState* state, int width, int height, int maskWidth = 0, int maskHeight = 0)
    {
        if (delegating || (!mask && !groupDepth)) return;
        if (++images > 65536) { complete = false; return; }
        const double* matrix = state->getCTM();
        const double x = std::hypot(matrix[0], matrix[1]);
        const double y = std::hypot(matrix[2], matrix[3]);
        if (!std::isfinite(x) || !std::isfinite(y) || x <= 0 || y <= 0 || width <= 0 || height <= 0 ||
            maskWidth < 0 || maskHeight < 0)
        { complete = false; return; }
        const double needed = std::max(std::max(width, maskWidth) / x, std::max(height, maskHeight) / y);
        if (!std::isfinite(needed)) { complete = false; return; }
        scale = std::max(scale, needed);
    }
public:
    bool complete = true;
    double scale = 96.0 / 72.0;
    GBool upsideDown() override { return gFalse; }
    GBool useDrawChar() override { return gTrue; }
    GBool interpretType3Chars() override { return gFalse; }
    GBool shadedFill(GfxState*, GfxShading*) override { return gTrue; }
    GBool shouldDrawFormFields() { return gFalse; }
    GBool shouldDrawAnnotation(Annot* annotation)
    {
        GString* type = annotation ? annotation->getType() : NULL;
        return type && type->cmp("Widget") != 0;
    }
    void saveState(GfxState*) override
    {
        if (masks.size() >= 4096) { complete = false; return; }
        masks.push_back(mask);
    }
    void restoreState(GfxState*) override
    {
        if (masks.empty()) { complete = false; return; }
        mask = masks.back(); masks.pop_back();
    }
    void beginTransparencyGroup(GfxState*, double*, GfxColorSpace*, GBool, GBool, GBool) override
    {
        if (groupDepth >= 4096) { complete = false; return; }
        ++groupDepth;
    }
    void paintTransparencyGroup(GfxState*, double*) override
    {
        if (!groupDepth) { complete = false; return; }
        --groupDepth;
    }
    void setSoftMask(GfxState*, double*, GBool, Function*, GfxColor*) override
    {
        if (!groupDepth) { complete = false; return; }
        --groupDepth; mask = true;
    }
    void clearSoftMask(GfxState*) override { mask = false; }
    void setSoftMaskFromImageMask(GfxState*, Gfx*, Object*, Stream*, int, int, GBool, GBool, GBool) override
    { complete = false; }
    void endPage() override { if (groupDepth) complete = false; }
    // Gfx restores its initial page save only after endPage, in its destructor.
    bool Finished() const { return complete && !groupDepth && masks.empty(); }
    void drawImageMask(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GBool invert, GBool inlineImage, GBool interpolate) override
    {
        Image(state, width, height); ImageScope scope(delegating);
        OutputDev::drawImageMask(state, gfx, ref, stream, width, height, invert, inlineImage, interpolate);
    }
    void drawImage(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GfxImageColorMap* colors, int* maskColors, GBool inlineImage, GBool interpolate) override
    {
        Image(state, width, height); ImageScope scope(delegating);
        OutputDev::drawImage(state, gfx, ref, stream, width, height, colors, maskColors, inlineImage, interpolate);
    }
    void drawMaskedImage(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GfxImageColorMap* colors, Object* maskRef, Stream* maskStream,
        int maskWidth, int maskHeight, GBool invert, GBool interpolate) override
    {
        Image(state, width, height, maskWidth, maskHeight); ImageScope scope(delegating);
        OutputDev::drawMaskedImage(state, gfx, ref, stream, width, height, colors, maskRef, maskStream,
            maskWidth, maskHeight, invert, interpolate);
    }
    void drawSoftMaskedImage(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GfxImageColorMap* colors, Object* maskRef, Stream* maskStream,
        int maskWidth, int maskHeight, GfxImageColorMap* maskColors, double* matte, GBool interpolate) override
    {
        Image(state, width, height, maskWidth, maskHeight); ImageScope scope(delegating);
        OutputDev::drawSoftMaskedImage(state, gfx, ref, stream, width, height, colors, maskRef, maskStream,
            maskWidth, maskHeight, maskColors, matte, interpolate);
    }
};
}}
#endif
