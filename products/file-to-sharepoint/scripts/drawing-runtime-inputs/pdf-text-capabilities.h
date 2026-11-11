// Source-text capability observer for the pinned native PDF reader.
// PDF syntax, CMaps, Unicode and reading order remain owned by Xpdf.
#ifndef C2S_PDF_TEXT_CAPABILITIES_H
#define C2S_PDF_TEXT_CAPABILITIES_H

#include <algorithm>
#include <cmath>
#include <map>
#include <string>
#include <utility>
#include <vector>
#include "../lib/xpdf/Annot.h"
#include "../lib/xpdf/CharCodeToUnicode.h"
#include "../lib/xpdf/GfxFont.h"
#include "../lib/xpdf/GfxState.h"
#include "../lib/xpdf/GlobalParams.h"
#include "../lib/xpdf/PDFDoc.h"
#include "../lib/xpdf/TextOutputDev.h"
#include "../lib/xpdf/XRef.h"
#include "../lib/goo/GString.h"
#include "../../DesktopEditor/common/Base64.h"
#include "../../DesktopEditor/common/File.h"
#include "PdfTextOrder.h"
#include "PdfCaptureRasterDensity.h"
#include "PdfActualTextRun.h"

namespace PdfReader
{
namespace SourceText
{
static const unsigned int MaxUnits = 1048576;
static const unsigned int MaxBytes = 4194304;
static const unsigned int MaxPages = 4096;
static const unsigned int MaxFonts = 4096;

inline bool ValidScalar(Unicode u)
{
    return u == 9 || u == 10 || u == 13 || (u >= 0x20 && u <= 0xD7FF) ||
        (u >= 0xE000 && u <= 0xFFFD) || (u >= 0x10000 && u <= 0x10FFFF);
}

inline bool MeaningfulScalar(unsigned int u)
{
    if ((u >= 9 && u <= 13) || u == 0x20 || u == 0x85 || u == 0xA0 || u == 0x1680 ||
        (u >= 0x2000 && u <= 0x200A) || u == 0x2028 || u == 0x2029 || u == 0x202F ||
        u == 0x205F || u == 0x3000 || u == 0x200B || u == 0x200E || u == 0x200F ||
        (u >= 0x202A && u <= 0x202E) || (u >= 0x2066 && u <= 0x2069) || u == 0xFEFF)
        return false;
    return true;
}

struct PageInfo
{
    unsigned int index, offset, length, scalars, meaningful, type3, unmapped, images, paths, textOps;
    double captureDpi, captureWidth, captureHeight;
    bool captureRequired;
};

struct Result
{
    bool complete = true;
    bool truncated = false;
    unsigned int units = 0;
    unsigned int retainedUnits = 0;
    unsigned int glyphs = 0;
    unsigned int cmapBytes = 0;
    unsigned int type3 = 0;
    unsigned int unmapped = 0;
    unsigned int invalid = 0;
    unsigned int actualText = 0, actualTextUnsupported = 0;
    unsigned int softMaskedText = 0;
    unsigned int groupedText = 0;
    unsigned int groups = 0;
    unsigned int softMasks = 0;
    unsigned int maxGroupDepth = 0;
    unsigned int graphicsUnsupported = 0;
    unsigned int graphicsReasons = 0;
    unsigned int captureRasterImages = 0, captureDownsampledImages = 0;
    unsigned int standaloneShadings = 0, shadingUnits = 0;
    unsigned int bodyImages = 0, bodyPaths = 0;
    OrderResult order;
    std::string text;
    std::vector<PageInfo> pages;

    void Limit() { complete = false; truncated = true; }
    void Count(unsigned int& value) { if (value < MaxUnits) ++value; else Limit(); }
    bool Observe(const Unicode* u, int length)
    {
        if (length < 0 || (length && !u)) { complete = false; return false; }
        if (static_cast<unsigned int>(length) > MaxUnits - units) { Limit(); return false; }
        units += static_cast<unsigned int>(length);
        bool valid = true;
        for (int i = 0; i < length; ++i)
            if (!ValidScalar(u[i])) { Count(invalid); valid = false; }
        return valid && !truncated;
    }

    void AddPage(GString* extracted, unsigned int pageType3, unsigned int pageUnmapped,
        unsigned int pageImages, unsigned int pagePaths, unsigned int pageTextOps,
        double captureDpi, double captureWidth, double captureHeight, bool captureRequired)
    {
        if (pages.size() >= MaxPages) { Limit(); return; }
        const unsigned int separator = pages.empty() ? 0 : 3;
        const unsigned int length = extracted ? static_cast<unsigned int>(extracted->getLength()) : 0;
        if (!extracted || length > MaxBytes - text.size() || separator > MaxBytes - text.size() - length)
        { Limit(); return; }
        if (separator) text.append("\n\f\n", 3);
        const unsigned int offset = static_cast<unsigned int>(text.size());
        if (!truncated) text.append(extracted->getCString(), length);
        unsigned int retained = static_cast<unsigned int>(text.size()) - offset;
        const std::wstring unicode = NSFile::CUtf8Converter::GetUnicodeStringFromUTF8(
            reinterpret_cast<BYTE*>(const_cast<char*>(text.data() + offset)), retained);
        unsigned int scalars = 0, meaningful = 0;
        for (size_t i = 0; i < unicode.size(); ++i)
        {
            unsigned int u = static_cast<unsigned int>(unicode[i]);
            if (sizeof(wchar_t) == 2 && u >= 0xD800 && u <= 0xDBFF && i + 1 < unicode.size())
                u = 0x10000 + ((u - 0xD800) << 10) + (static_cast<unsigned int>(unicode[++i]) - 0xDC00);
            ++scalars;
            if (MeaningfulScalar(u)) ++meaningful;
        }
        if (scalars > MaxUnits - retainedUnits)
        {
            text.resize(offset);
            retained = scalars = meaningful = 0;
            Limit();
        }
        retainedUnits += scalars;
        pages.push_back({static_cast<unsigned int>(pages.size()), offset, retained,
            scalars, meaningful, pageType3, pageUnmapped, pageImages, pagePaths, pageTextOps,
            captureDpi, captureWidth, captureHeight, captureRequired});
    }

    std::wstring JsonFields()
    {
        char* encoded = NULL;
        int encodedLength = 0;
        if (!text.empty()) NSFile::CBase64Converter::Encode(
            reinterpret_cast<BYTE*>(const_cast<char*>(text.data())), static_cast<int>(text.size()),
            encoded, encodedLength, NSBase64::B64_BASE64_FLAG_NOCRLF);
        std::wstring base64;
        if (encoded && encodedLength > 0)
            base64 = NSFile::CUtf8Converter::GetUnicodeStringFromUTF8(reinterpret_cast<BYTE*>(encoded), encodedLength);
        delete[] encoded;
        if (!complete || truncated || order.pages.size() != pages.size()) order.complete = false;
        std::wstring json = order.JsonFields() + L"\"TextCapabilityVersion\":1,\"TextScanComplete\":";
        json += complete ? L"true" : L"false";
        json += L",\"TextPagesVisited\":" + std::to_wstring(pages.size());
        json += L",\"TextType3Glyphs\":" + std::to_wstring(type3);
        json += L",\"TextType3UnmappedGlyphs\":" + std::to_wstring(unmapped);
        json += L",\"TextInvalidScalars\":" + std::to_wstring(invalid);
        json += L",\"TextActualTextSpans\":" + std::to_wstring(actualText);
        json += L",\"TextActualTextCapabilityVersion\":1,\"TextActualTextUnsupportedSpans\":" + std::to_wstring(actualTextUnsupported);
        json += L",\"TextSoftMaskedGlyphs\":" + std::to_wstring(softMaskedText);
        json += L",\"TextTransparencyGroupGlyphs\":" + std::to_wstring(groupedText);
        json += L",\"GraphicsCapabilityVersion\":1";
        json += L",\"GraphicsTransparencyGroups\":" + std::to_wstring(groups);
        json += L",\"GraphicsSoftMasks\":" + std::to_wstring(softMasks);
        json += L",\"GraphicsTransparencyMaxDepth\":" + std::to_wstring(maxGroupDepth);
        json += L",\"GraphicsUnsupportedFeatures\":" + std::to_wstring(graphicsUnsupported);
        json += L",\"GraphicsUnsupportedReasons\":" + std::to_wstring(graphicsReasons);
        json += L",\"GraphicsCaptureDpi\":96,\"GraphicsCaptureProfile\":\"page-source-density-bgra-v1\"";
        json += L",\"GraphicsCaptureMaxPixels\":9437184,\"GraphicsCaptureMaxDimension\":4096,\"GraphicsCaptureMaxBytes\":134217728";
        json += L",\"GraphicsCaptureRasterImages\":" + std::to_wstring(captureRasterImages);
        json += L",\"GraphicsCaptureDownsampledImages\":" + std::to_wstring(captureDownsampledImages);
        json += L",\"GraphicsStandaloneShadings\":" + std::to_wstring(standaloneShadings);
        json += L",\"TextTruncated\":";
        json += truncated ? L"true" : L"false";
        json += L",\"TextUtf8Base64\":\"" + base64 + L"\",\"TextPages\":[";
        for (size_t i = 0; i < pages.size(); ++i)
        {
            if (i) json += L",";
            const PageInfo& p = pages[i];
            json += L"{\"pageIndex\":" + std::to_wstring(p.index) +
                L",\"utf8Offset\":" + std::to_wstring(p.offset) +
                L",\"utf8Length\":" + std::to_wstring(p.length) +
                L",\"unicodeScalars\":" + std::to_wstring(p.scalars) +
                L",\"meaningfulScalars\":" + std::to_wstring(p.meaningful) +
                L",\"type3Glyphs\":" + std::to_wstring(p.type3) +
                L",\"type3UnmappedGlyphs\":" + std::to_wstring(p.unmapped) +
                L",\"bodyImageOps\":" + std::to_wstring(p.images) +
                L",\"bodyPathOps\":" + std::to_wstring(p.paths) +
                L",\"bodyTextOps\":" + std::to_wstring(p.textOps) +
                L",\"captureRequired\":" + (p.captureRequired ? L"true" : L"false") +
                L",\"captureDpi\":" + std::to_wstring(p.captureDpi) +
                L",\"captureWidthPx\":" + std::to_wstring(p.captureWidth) +
                L",\"captureHeightPx\":" + std::to_wstring(p.captureHeight) + L"}";
        }
        return json + L"],";
    }
};

class ScopedSettings
{
    GlobalParams* params;
    GString* encoding;
    GBool annotations, forms;
public:
    explicit ScopedSettings(GlobalParams* p) : params(p), encoding(p->getTextEncodingName()),
        annotations(p->getDrawAnnotations()), forms(p->getDrawFormFields())
    {
        params->setTextEncoding("UTF-8");
        params->setDrawAnnotations(gTrue);
        params->setDrawFormFields(gFalse);
    }
    ~ScopedSettings()
    {
        params->setTextEncoding(encoding->getCString());
        params->setDrawAnnotations(annotations);
        params->setDrawFormFields(forms);
        delete encoding;
    }
};

class Observer : public TextOutputDev
{
    Result& result;
    XRef* xref;
    std::map<std::pair<int, int>, CharCodeToUnicode*> explicitMaps;
    bool actualTextForwarded = false, actualTextUnsupported = false;
    SemanticText::UniformRun actualTextRun;
    unsigned int actualTextDepth = 0;
    double captureScale = 96.0 / 72.0, captureWidth = 0, captureHeight = 0;
    bool softMaskActive = false;
    std::vector<bool> savedMasks;
    std::vector<bool> groupMasks;
    unsigned int maskGroupDepth = 0;
    bool isolatedOuterGroup = false, outerGroupEnded = false;
    double pagePixels = 0;
    double pageScaleX = 0, pageScaleY = 0;
    bool validPageDimensions = false;
    bool delegatingImage = false;
    class ImageScope
    {
        bool& flag;
        bool previous;
    public:
        explicit ImageScope(bool& value) : flag(value), previous(value) { flag = true; }
        ~ImageScope() { flag = previous; }
    };
    void CountImage(GfxState* state, int width, int height, int maskWidth = 0, int maskHeight = 0)
    {
        if (delegatingImage) return;
        result.Count(result.bodyImages);
        if (!softMaskActive && groupMasks.empty()) return;
        result.Count(result.captureRasterImages);
        const double* matrix = state->getCTM();
        const double displayWidth = std::hypot(matrix[0] * pageScaleX, matrix[1] * pageScaleY);
        const double displayHeight = std::hypot(matrix[2] * pageScaleX, matrix[3] * pageScaleY);
        if (!std::isfinite(displayWidth) || !std::isfinite(displayHeight) ||
            displayWidth <= 0 || displayHeight <= 0 || width <= 0 || height <= 0 ||
            std::max(width, maskWidth) > displayWidth + 1e-9 ||
            std::max(height, maskHeight) > displayHeight + 1e-9)
        {
            result.Count(result.captureDownsampledImages);
            Unsupported(512);
        }
    }

    void Unsupported(unsigned int reason)
    {
        if (!(result.graphicsReasons & reason)) result.Count(result.graphicsUnsupported);
        result.graphicsReasons |= reason;
    }
    void CheckBlend(GfxState* state)
    {
        // Only an isolated outer capture owns the backdrop for internal blends.
        const GfxBlendMode mode = state->getBlendMode();
        if (mode != gfxBlendNormal && (!isolatedOuterGroup || outerGroupEnded ||
            mode < gfxBlendNormal || mode > gfxBlendExclusion)) Unsupported(64);
    }
    void CheckGraphicsBounds(unsigned int depth)
    {
        if (!validPageDimensions || pagePixels > 9.0 * 1024 * 1024) Unsupported(1);
        if (depth > 16) Unsupported(2);
        if (pagePixels * 4 * (depth + 2) > 128.0 * 1024 * 1024) Unsupported(4);
    }

    void UnsupportedActualText()
    {
        if (!actualTextUnsupported) { result.Count(result.actualTextUnsupported); actualTextUnsupported = true; }
    }

    CharCodeToUnicode* ExplicitMap(GfxFont* font)
    {
        const Ref* ref = font->getID();
        const std::pair<int, int> key(ref->num, ref->gen);
        const auto found = explicitMaps.find(key);
        if (found != explicitMaps.end()) return found->second;
        if (explicitMaps.size() >= MaxFonts) { result.Limit(); return NULL; }
        explicitMaps[key] = NULL;
        Object fontObject, mapping;
        xref->fetch(ref->num, ref->gen, &fontObject);
        if (!fontObject.isDict() || !fontObject.dictLookup("ToUnicode", &mapping)->isStream())
        { mapping.free(); fontObject.free(); return NULL; }
        GString bytes;
        char buffer[4096];
        int count = 0;
        mapping.streamReset();
        while ((count = mapping.streamGetBlock(buffer, sizeof(buffer))) > 0)
        {
            if (static_cast<unsigned int>(count) > MaxBytes - result.cmapBytes)
            { result.Limit(); break; }
            result.cmapBytes += static_cast<unsigned int>(count);
            bytes.append(buffer, count);
        }
        mapping.streamClose();
        mapping.free(); fontObject.free();
        if (result.truncated) return NULL;
        explicitMaps[key] = CharCodeToUnicode::parseCMap(&bytes, 8);
        return explicitMaps[key];
    }
public:
    Observer(XRef* x, Result& r, TextOutputControl* control) :
        TextOutputDev(static_cast<char*>(NULL), control, gFalse), result(r), xref(x) {}
    void SetCaptureScale(double scale) { captureScale = scale; }
    double CaptureDpi() const { return std::isfinite(captureScale * 72.0) ? captureScale * 72.0 : 96.0; }
    double CaptureWidth() const { return captureWidth; }
    double CaptureHeight() const { return captureHeight; }
    // Observe existing graphics capability callbacks; this output device never paints pixels.
    GBool needNonText() override { return gTrue; }
    void stroke(GfxState* state) override
    { result.Count(result.bodyPaths); TextOutputDev::stroke(state); }
    void fill(GfxState* state) override
    { result.Count(result.bodyPaths); TextOutputDev::fill(state); }
    void eoFill(GfxState* state) override
    { result.Count(result.bodyPaths); TextOutputDev::eoFill(state); }
    GBool shadedFill(GfxState* state, GfxShading* shading) override
    {
        // The DOCX reader captures a standalone native shading as one bounded
        // nontext operation. Observe parsed mesh work without decomposing it
        // into thousands of synthetic path callbacks or source raster images.
        result.Count(result.bodyPaths);
        const int type = shading ? shading->getType() : 0;
        if (type < 1 || type > 7)
        { result.complete = false; Unsupported(1024); return gTrue; }
        int work = 1;
        if (type == 4 || type == 5)
            work = static_cast<GfxGouraudTriangleShading*>(shading)->getNTriangles();
        else if (type == 6 || type == 7)
            work = static_cast<GfxPatchMeshShading*>(shading)->getNPatches();
        if (work < 0 || static_cast<unsigned int>(work) > MaxUnits - result.shadingUnits)
            result.Limit();
        else result.shadingUnits += static_cast<unsigned int>(work);
        if (groupMasks.empty() && !softMaskActive)
        {
            result.Count(result.standaloneShadings);
            CheckGraphicsBounds(0);
            CheckBlend(state);
        }
        return gTrue;
    }
    void drawImageMask(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GBool invert, GBool inlineImage, GBool interpolate) override
    {
        CountImage(state, width, height); ImageScope scope(delegatingImage);
        TextOutputDev::drawImageMask(state, gfx, ref, stream, width, height, invert, inlineImage, interpolate);
    }
    void drawImage(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GfxImageColorMap* colors, int* maskColors,
        GBool inlineImage, GBool interpolate) override
    {
        CountImage(state, width, height); ImageScope scope(delegatingImage);
        TextOutputDev::drawImage(state, gfx, ref, stream, width, height, colors, maskColors, inlineImage, interpolate);
    }
    void drawMaskedImage(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GfxImageColorMap* colors, Object* maskRef, Stream* mask,
        int maskWidth, int maskHeight, GBool invert, GBool interpolate) override
    {
        CountImage(state, width, height, maskWidth, maskHeight); ImageScope scope(delegatingImage);
        TextOutputDev::drawMaskedImage(state, gfx, ref, stream, width, height, colors,
            maskRef, mask, maskWidth, maskHeight, invert, interpolate);
    }
    void drawSoftMaskedImage(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GfxImageColorMap* colors, Object* maskRef, Stream* mask,
        int maskWidth, int maskHeight, GfxImageColorMap* maskColors, double* matte,
        GBool interpolate) override
    {
        CountImage(state, width, height, maskWidth, maskHeight); ImageScope scope(delegatingImage);
        TextOutputDev::drawSoftMaskedImage(state, gfx, ref, stream, width, height, colors,
            maskRef, mask, maskWidth, maskHeight, maskColors, matte, interpolate);
    }
    ~Observer()
    {
        for (auto& entry : explicitMaps) if (entry.second) entry.second->decRefCnt();
    }
    void startPage(int pageNum, GfxState* state) override
    {
        softMaskActive = false;
        savedMasks.clear(); groupMasks.clear(); maskGroupDepth = 0;
        isolatedOuterGroup = outerGroupEnded = false;
        actualTextForwarded = actualTextUnsupported = false; actualTextDepth = 0;
        const double width = captureWidth = std::ceil(state->getPageWidth() * captureScale);
        const double height = captureHeight = std::ceil(state->getPageHeight() * captureScale);
        validPageDimensions = std::isfinite(width) && std::isfinite(height) &&
            width > 0 && height > 0 && width <= 4096 && height <= 4096;
        // Keep unsupported extreme frames valid JSON; their capture callbacks
        // independently record the explicit allocation-capability failure.
        if (!std::isfinite(captureWidth)) captureWidth = 0;
        if (!std::isfinite(captureHeight)) captureHeight = 0;
        pagePixels = validPageDimensions ? width * height : 0;
        pageScaleX = state->getPageWidth() > 0 ? width / state->getPageWidth() : 0;
        pageScaleY = state->getPageHeight() > 0 ? height / state->getPageHeight() : 0;
        TextOutputDev::startPage(pageNum, state);
    }
    void endPage() override
    {
        if (actualTextDepth) { UnsupportedActualText(); result.complete = false; }
        TextOutputDev::endPage();
    }
    void saveState(GfxState* state) override
    {
        if (savedMasks.size() < MaxPages) savedMasks.push_back(softMaskActive);
        else result.Limit();
        TextOutputDev::saveState(state);
    }
    void restoreState(GfxState* state) override
    {
        if (savedMasks.empty()) Unsupported(256);
        else { softMaskActive = savedMasks.back(); savedMasks.pop_back(); }
        if (softMaskActive || !groupMasks.empty()) CheckBlend(state);
        TextOutputDev::restoreState(state);
    }
    void updateBlendMode(GfxState* state) override
    {
        if (softMaskActive || !groupMasks.empty()) CheckBlend(state);
        TextOutputDev::updateBlendMode(state);
    }
    void beginTransparencyGroup(GfxState* state, double* bbox,
        GfxColorSpace* colorSpace, GBool isolated, GBool knockout, GBool forSoftMask) override
    {
        result.Count(result.groups);
        if (groupMasks.size() >= MaxPages) { result.Limit(); return; }
        if (groupMasks.empty()) { isolatedOuterGroup = isolated; outerGroupEnded = false; }
        groupMasks.push_back(forSoftMask);
        if (forSoftMask) ++maskGroupDepth;
        result.maxGroupDepth = std::max(result.maxGroupDepth, static_cast<unsigned int>(groupMasks.size()));
        CheckGraphicsBounds(static_cast<unsigned int>(groupMasks.size()));
        CheckBlend(state);
        if (knockout) Unsupported(8);
        TextOutputDev::beginTransparencyGroup(state, bbox, colorSpace, isolated, knockout, forSoftMask);
    }
    void endTransparencyGroup(GfxState* state) override
    {
        if (groupMasks.empty()) Unsupported(256);
        else if (groupMasks.size() == 1) outerGroupEnded = true;
        TextOutputDev::endTransparencyGroup(state);
    }
    void paintTransparencyGroup(GfxState* state, double* bbox) override
    {
        if (groupMasks.empty()) Unsupported(256);
        else
        {
            if (groupMasks.size() == 1 && state->getBlendMode() != gfxBlendNormal) Unsupported(64);
            CheckBlend(state);
            if (groupMasks.back()) --maskGroupDepth;
            groupMasks.pop_back();
            if (groupMasks.empty()) isolatedOuterGroup = outerGroupEnded = false;
        }
        TextOutputDev::paintTransparencyGroup(state, bbox);
    }
    void setSoftMask(GfxState* state, double* bbox, GBool alpha,
        Function* transfer, GfxColor* backdrop) override
    {
        softMaskActive = true;
        result.Count(result.softMasks);
        CheckGraphicsBounds(static_cast<unsigned int>(groupMasks.size()));
        CheckBlend(state);
        if (transfer) Unsupported(16);
        if (backdrop) for (int i = 0; i < gfxColorMaxComps; ++i)
            if (backdrop->c[i] != 0) { Unsupported(32); break; }
        if (groupMasks.empty()) Unsupported(256);
        else
        {
            if (groupMasks.back()) --maskGroupDepth;
            groupMasks.pop_back();
            if (groupMasks.empty()) isolatedOuterGroup = outerGroupEnded = false;
        }
        TextOutputDev::setSoftMask(state, bbox, alpha, transfer, backdrop);
    }
    void clearSoftMask(GfxState* state) override
    {
        softMaskActive = false;
        TextOutputDev::clearSoftMask(state);
    }
    void setSoftMaskFromImageMask(GfxState* state, Gfx* gfx, Object* ref, Stream* stream,
        int width, int height, GBool invert, GBool inlineImage, GBool interpolate) override
    {
        Unsupported(128);
        TextOutputDev::setSoftMaskFromImageMask(state, gfx, ref, stream,
            width, height, invert, inlineImage, interpolate);
    }
    GBool shouldDrawAnnotation(Annot* annotation) override
    {
        GString* type = annotation ? annotation->getType() : NULL;
        return type && type->cmp("Widget") != 0;
    }
    void drawChar(GfxState* state, double x, double y, double dx, double dy,
        double originX, double originY, CharCode code, int nBytes, Unicode* u, int uLen) override
    {
        result.Count(result.glyphs);
        if (actualTextDepth && !actualTextRun.Add(state, x, y, dx, dy, originX, originY, nBytes)) UnsupportedActualText();
        if (softMaskActive || maskGroupDepth) result.Count(result.softMaskedText);
        if (!groupMasks.empty()) result.Count(result.groupedText);
        const bool valid = result.Observe(u, uLen);
        GfxFont* font = state->getFont();
        if (uLen < 1 && !actualTextForwarded) result.complete = false;
        if (font && font->getType() == fontType3)
        {
            result.Count(result.type3);
            Unicode explicitUnicode[8];
            CharCodeToUnicode* map = ExplicitMap(font);
            const int length = map ? map->mapToUnicode(code, explicitUnicode, 8) : 0;
            bool supported = length > 0 && length < 8 && length == uLen &&
                map->hasComplete8BitMappingSequence(code);
            if (length >= 8) result.Limit(); // Native capacity may have truncated the mapping.
            for (int i = 0; i < length; ++i)
                if (!ValidScalar(explicitUnicode[i]) || !u || i >= uLen || explicitUnicode[i] != u[i]) supported = false;
            if (!supported || !valid) result.Count(result.unmapped);
        }
        if (valid && !result.truncated)
            TextOutputDev::drawChar(state, x, y, dx, dy, originX, originY, code, nBytes, u, uLen);
    }
    void beginActualText(GfxState* state, Unicode* u, int length) override
    {
        result.Count(result.actualText);
        if (actualTextDepth++)
        {
            result.Count(result.actualTextUnsupported);
            result.complete = false;
            return;
        }
        actualTextUnsupported = false;
        actualTextRun.Reset();
        actualTextForwarded = length > 0 && result.Observe(u, length) && !result.truncated;
        if (!actualTextForwarded || state->getRender() != 0) UnsupportedActualText();
        if (actualTextForwarded) TextOutputDev::beginActualText(state, u, length);
    }
    void endActualText(GfxState* state) override
    {
        if (!actualTextDepth) { result.complete = false; return; }
        if (--actualTextDepth) return;
        if (!actualTextRun.HasGlyphs() || !actualTextRun.SameEndClip(state)) UnsupportedActualText();
        if (state->getRender() != 0) UnsupportedActualText();
        if (actualTextForwarded) TextOutputDev::endActualText(state);
        actualTextForwarded = false;
    }
    void unclosedActualText(GfxState*) override
    {
        UnsupportedActualText(); result.complete = false;
    }
};

inline void ScanDocument(PDFDoc* document, Result& result)
{
    if (!document || !document->getXRef()) { result.complete = false; return; }
    if (document->getNumPages() < 0 || static_cast<unsigned int>(document->getNumPages()) > MaxPages - result.pages.size())
    { result.Limit(); return; }
    TextOutputControl control;
    control.mode = textOutReadingOrder;
    Observer observer(document->getXRef(), result, &control);
    for (int page = 1; page <= document->getNumPages(); ++page)
    {
        const unsigned int beforeType3 = result.type3, beforeUnmapped = result.unmapped;
        const unsigned int beforeImages = result.bodyImages, beforePaths = result.bodyPaths, beforeTextOps = result.glyphs;
        const unsigned int beforeGroups = result.groups, beforeMasks = result.softMasks;
        const unsigned int beforeShadings = result.standaloneShadings;
        DocxCapture::RasterDensity density;
        document->displayPage(&density, page, 72.0, 72.0, 0, gFalse, gTrue, gFalse);
        if (!density.Finished())
        {
            result.complete = false;
            result.Count(result.graphicsUnsupported); result.graphicsReasons |= 256;
        }
        observer.SetCaptureScale(density.scale);
        document->displayPage(&observer, page, 72.0, 72.0, 0, gFalse, gTrue, gFalse);
        double width = document->getPageCropWidth(page), height = document->getPageCropHeight(page);
        const int rotation = ((document->getPageRotate(page) % 360) + 360) % 360;
        if (rotation == 90 || rotation == 270) std::swap(width, height);
        GString* text = observer.getText(0, 0, width, height);
        if (!result.truncated)
            result.order.AddPage(observer, text, static_cast<unsigned int>(result.pages.size()), width, height, rotation);
        else result.order.Limit();
        result.AddPage(text, result.type3 - beforeType3, result.unmapped - beforeUnmapped,
            result.bodyImages - beforeImages, result.bodyPaths - beforePaths, result.glyphs - beforeTextOps,
            observer.CaptureDpi(), observer.CaptureWidth(), observer.CaptureHeight(),
            result.groups > beforeGroups || result.softMasks > beforeMasks || result.standaloneShadings > beforeShadings);
        delete text;
        if (result.truncated) break;
    }
}
}
}
#endif
