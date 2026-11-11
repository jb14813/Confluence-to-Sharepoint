// Bounded geometry from the pinned reader's existing reading-order word API.
#ifndef C2S_PDF_TEXT_ORDER_H
#define C2S_PDF_TEXT_ORDER_H
#include <array>
#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "../lib/xpdf/TextOutputDev.h"
#include "../lib/goo/GString.h"
#include "../lib/goo/GList.h"
#include "../../DesktopEditor/common/File.h"

namespace PdfReader { namespace SourceText {
inline bool MeaningfulScalar(unsigned int u);
inline bool ValidScalar(Unicode u);

// Use the existing native hierarchy, never baseline-distance grouping.
inline bool ReadNativeTextStructure(TextPage& text, const std::vector<unsigned int>& expected,
    const std::vector<unsigned int>& wordStarts, std::vector<unsigned int>& lineStarts,
    std::vector<unsigned int>& paragraphStarts, unsigned int maxWords)
{
    struct ColumnsDeleter
    {
        void operator()(GList* list) const
        {
            if (!list) return;
            for (int i = 0; i < list->getLength(); ++i) delete static_cast<TextColumn*>(list->get(i));
            delete list;
        }
    };
    std::unique_ptr<GList, ColumnsDeleter> columns(text.makeColumns());
    if (!columns || columns->getLength() < 0) return false;
    size_t offset = 0;
    unsigned int words = 0, nodes = 0;
    for (int c = 0; c < columns->getLength(); ++c)
    {
        TextColumn* column = static_cast<TextColumn*>(columns->get(c));
        if (!column || ++nodes > 3 * maxWords || !column->getParagraphs()) return false;
        GList* paragraphs = column->getParagraphs();
        for (int p = 0; p < paragraphs->getLength(); ++p)
        {
            TextParagraph* paragraph = static_cast<TextParagraph*>(paragraphs->get(p));
            if (!paragraph || ++nodes > 3 * maxWords || !paragraph->getLines()) return false;
            const unsigned int paragraphStart = static_cast<unsigned int>(offset);
            GList* lines = paragraph->getLines();
            for (int l = 0; l < lines->getLength(); ++l)
            {
                TextLine* line = static_cast<TextLine*>(lines->get(l));
                if (!line || ++nodes > 3 * maxWords || !line->getWords()) return false;
                const unsigned int lineStart = static_cast<unsigned int>(offset);
                GList* lineWords = line->getWords();
                for (int w = 0; w < lineWords->getLength(); ++w)
                {
                    TextWord* word = static_cast<TextWord*>(lineWords->get(w));
                    if (!word || ++words > maxWords || word->getLength() < 0) return false;
                    for (int i = 0; i < word->getLength(); ++i)
                    {
                        const unsigned int scalar = word->getChar(i);
                        if (!ValidScalar(scalar)) return false;
                        if (!MeaningfulScalar(scalar)) continue;
                        if (offset >= expected.size() || expected[offset] != scalar) return false;
                        ++offset;
                    }
                }
                if (offset != lineStart)
                {
                    if (!std::binary_search(wordStarts.begin(), wordStarts.end(), lineStart)) return false;
                    lineStarts.push_back(lineStart);
                }
            }
            if (offset != paragraphStart) paragraphStarts.push_back(paragraphStart);
        }
    }
    return offset == expected.size();
}

struct OrderedPage
{
    unsigned int index;
    double width, height;
    int rotation;
    std::vector<unsigned int> scalars, wordStarts, lineStarts, paragraphStarts;
    std::vector<std::array<double, 4>> boxes;
};

struct OrderResult
{
    static const unsigned int MaxWords = 16384, MaxCharacters = 65536;
    static const unsigned int MaxSerializedBytes = 16777216;
    bool complete = true, truncated = false;
    unsigned int words = 0, characters = 0, unsupportedReasons = 0;
    std::vector<OrderedPage> pages;

    void Limit() { complete = false; truncated = true; }
    void Unsupported(unsigned int reason) { complete = false; unsupportedReasons |= reason; }

    void AddPage(TextOutputDev& observer, GString* source, unsigned int index,
        double width, double height, int rotation)
    {
        if (truncated) return;
        OrderedPage page;
        page.index = index; page.width = width; page.height = height; page.rotation = rotation;
        if (!std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0)
        { Unsupported(4); return; }
        // These coordinate/bidi relationships require separate native proof.
        if (rotation != 0) Unsupported(1);
        std::unique_ptr<TextWordList> list(observer.makeWordListForRect(0, 0, width, height));
        if (!list || list->getLength() < 0) { Unsupported(16); return; }
        if (static_cast<unsigned int>(list->getLength()) > MaxWords - words) { Limit(); return; }
        words += static_cast<unsigned int>(list->getLength());
        std::map<unsigned int, int> coverage;
        for (int i = 0; i < list->getLength(); ++i)
        {
            TextWord* word = list->get(i);
            if (!word || word->getLength() < 0) { Unsupported(16); return; }
            if (word->getDirection() < 0) Unsupported(2);
            if (static_cast<unsigned int>(word->getLength()) > MaxCharacters - characters) { Limit(); return; }
            characters += static_cast<unsigned int>(word->getLength());
            bool started = false;
            for (int j = 0; j < word->getLength(); ++j)
            {
                const unsigned int scalar = word->getChar(j);
                if (!ValidScalar(scalar)) { Unsupported(8); continue; }
                if (!MeaningfulScalar(scalar)) continue;
                std::array<double, 4> box = {{0, 0, 0, 0}};
                word->getCharBBox(j, &box[0], &box[1], &box[2], &box[3]);
                bool finite = true;
                for (const double coordinate : box)
                    if (!std::isfinite(coordinate) || std::fabs(coordinate) > 10000000) finite = false;
                if (!finite || box[0] > box[2] || box[1] > box[3]) { Unsupported(4); return; }
                if (!started) { page.wordStarts.push_back(static_cast<unsigned int>(page.scalars.size())); started = true; }
                page.scalars.push_back(scalar); page.boxes.push_back(box); ++coverage[scalar];
            }
        }
        if (!source) { Unsupported(8); return; }
        const std::wstring text = NSFile::CUtf8Converter::GetUnicodeStringFromUTF8(
            reinterpret_cast<BYTE*>(source->getCString()), source->getLength());
        for (size_t i = 0; i < text.size(); ++i)
        {
            unsigned int scalar = static_cast<unsigned int>(text[i]);
            if (sizeof(wchar_t) == 2 && scalar >= 0xD800 && scalar <= 0xDBFF && i + 1 < text.size())
                scalar = 0x10000 + ((scalar - 0xD800) << 10) + (static_cast<unsigned int>(text[++i]) - 0xDC00);
            if (MeaningfulScalar(scalar)) --coverage[scalar];
        }
        for (const auto& entry : coverage) if (entry.second != 0) { Unsupported(8); break; }
        // takeText transfers ownership and installs a fresh TextPage in observer.
        // Source extraction and WordList scalar/box reads are complete above.
        std::unique_ptr<TextPage> structurePage(observer.takeText());
        if (!structurePage || !ReadNativeTextStructure(*structurePage, page.scalars,
            page.wordStarts, page.lineStarts, page.paragraphStarts, MaxWords)) Unsupported(32);
        pages.push_back(std::move(page));
    }

    std::wstring JsonFields()
    {
        std::wstring entries;
        for (const OrderedPage& page : pages)
        {
            if (!entries.empty()) entries += L",";
            entries += L"{\"pageIndex\":" + std::to_wstring(page.index) +
                L",\"widthPt\":" + std::to_wstring(page.width) + L",\"heightPt\":" + std::to_wstring(page.height) +
                L",\"rotation\":" + std::to_wstring(page.rotation) + L",\"unicodeScalars\":[";
            for (size_t i = 0; i < page.scalars.size(); ++i)
            { if (i) entries += L","; entries += std::to_wstring(page.scalars[i]); }
            entries += L"],\"scalarBoxesPt\":[";
            for (size_t i = 0; i < page.boxes.size(); ++i)
            {
                if (i) entries += L",";
                entries += L"[";
                for (size_t j = 0; j < 4; ++j)
                { if (j) entries += L","; entries += std::to_wstring(page.boxes[i][j]); }
                entries += L"]";
            }
            entries += L"],\"wordStarts\":[";
            for (size_t i = 0; i < page.wordStarts.size(); ++i)
            { if (i) entries += L","; entries += std::to_wstring(page.wordStarts[i]); }
            entries += L"],\"lineStarts\":[";
            for (size_t i = 0; i < page.lineStarts.size(); ++i)
            { if (i) entries += L","; entries += std::to_wstring(page.lineStarts[i]); }
            entries += L"],\"paragraphStarts\":[";
            for (size_t i = 0; i < page.paragraphStarts.size(); ++i)
            { if (i) entries += L","; entries += std::to_wstring(page.paragraphStarts[i]); }
            entries += L"]}";
            // This payload is ASCII, so wchar count is serialized UTF-8 bytes.
            if (entries.size() > MaxSerializedBytes - 512) { Limit(); entries.clear(); break; }
        }
        std::wstring json = L"\"TextOrderCapabilityVersion\":1,\"TextOrderScanComplete\":";
        json += complete ? L"true" : L"false";
        json += L",\"TextOrderTruncated\":";
        json += truncated ? L"true" : L"false";
        json += L",\"TextOrderUnsupportedReasons\":" + std::to_wstring(unsupportedReasons);
        json += L",\"TextOrderCoordinateSpace\":\"displayed-crop-top-left-pt\",\"TextOrderedPages\":[" + entries + L"],";
        return json;
    }
};
} }
#endif
