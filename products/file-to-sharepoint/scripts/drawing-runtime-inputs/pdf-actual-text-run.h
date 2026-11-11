// Validate that author-provided ActualText replaces one uniform native run.
// PDF decoding, state and span geometry remain owned by the existing reader.
#ifndef C2S_PDF_ACTUAL_TEXT_RUN_H
#define C2S_PDF_ACTUAL_TEXT_RUN_H
#include <algorithm>
#include <cmath>
#include <limits>
#include "../lib/xpdf/GfxFont.h"
#include "../lib/xpdf/GfxState.h"
namespace PdfReader { namespace SemanticText {
class UniformRun
{
    bool seen = false;
    int fontNum = 0, fontGen = 0;
    double size = 0, opacity = 0, horizontal = 0, charSpace = 0, wordSpace = 0, rise = 0;
    double textMatrix[6] = {}, matrix[6] = {};
    double clip[4] = {};
    GfxRGB color;
    double endX = 0, endY = 0, directionX = 0, directionY = 0;
    static bool Finite(const double* values, unsigned int count)
    { for (unsigned int i = 0; i < count; ++i) if (!std::isfinite(values[i])) return false; return true; }
    static double Epsilon(double x, double y)
    { return std::max(1e-9, 64 * std::numeric_limits<double>::epsilon() * std::max(1.0, std::max(std::fabs(x), std::fabs(y)))); }
public:
    void Reset() { seen = false; }
    bool HasGlyphs() const { return seen; }
    bool SameEndClip(GfxState* state) const
    {
        if (!seen || !state) return false;
        double bounds[4]; state->getClipBBox(&bounds[0], &bounds[1], &bounds[2], &bounds[3]);
        for (unsigned int i = 0; i < 4; ++i) if (bounds[i] != clip[i]) return false;
        return true;
    }
    bool Add(GfxState* state, double x, double y, double dx, double dy,
        double originX, double originY, int bytes)
    {
        const double coordinates[] = {x, y, dx, dy, originX, originY};
        GfxFont* font = state ? state->getFont() : NULL;
        if (!font || bytes <= 0 || state->getRender() != 0 ||
            state->getBlendMode() != gfxBlendNormal || !Finite(coordinates, 6)) return false;
        const double* tm = state->getTextMat(); const double* ctm = state->getCTM();
        double bounds[4]; state->getClipBBox(&bounds[0], &bounds[1], &bounds[2], &bounds[3]);
        const double styles[] = {state->getFontSize(),state->getFillOpacity(),state->getHorizScaling(),
            state->getCharSpace(),state->getWordSpace(),state->getRise()};
        if (!Finite(tm, 6) || !Finite(ctm, 6) || !Finite(styles, 6) || !Finite(bounds, 4) || originX != 0 || originY != 0) return false;
        GfxRGB rgb; state->getFillRGB(&rgb);
        const Ref* ref = font->getID();
        if (!seen)
        {
            fontNum = ref->num; fontGen = ref->gen;
            size = styles[0]; opacity = styles[1]; horizontal = styles[2];
            charSpace = styles[3]; wordSpace = styles[4]; rise = styles[5];
            for (unsigned int i = 0; i < 6; ++i) { textMatrix[i] = tm[i]; matrix[i] = ctm[i]; }
            for (unsigned int i = 0; i < 4; ++i) clip[i] = bounds[i];
            color = rgb; directionX = dx; directionY = dy; seen = true;
        }
        else
        {
            if (ref->num != fontNum || ref->gen != fontGen || styles[0] != size || styles[1] != opacity ||
                styles[2] != horizontal || styles[3] != charSpace || styles[4] != wordSpace || styles[5] != rise ||
                rgb.r != color.r || rgb.g != color.g || rgb.b != color.b) return false;
            for (unsigned int i = 0; i < 6; ++i) if (tm[i] != textMatrix[i] || ctm[i] != matrix[i]) return false;
            for (unsigned int i = 0; i < 4; ++i) if (bounds[i] != clip[i]) return false;
            const double epsilon = Epsilon(x, y);
            if (std::fabs(x - endX) > epsilon || std::fabs(y - endY) > epsilon) return false;
            if (directionX == 0 && directionY == 0) { directionX = dx; directionY = dy; }
            const double scale = std::max(1.0, std::hypot(directionX, directionY) * std::hypot(dx, dy));
            if (std::fabs(directionX * dy - directionY * dx) > epsilon * scale || directionX * dx + directionY * dy < 0)
                return false;
        }
        endX = x + dx; endY = y + dy;
        return std::isfinite(endX) && std::isfinite(endY);
    }
};
}}
#endif
