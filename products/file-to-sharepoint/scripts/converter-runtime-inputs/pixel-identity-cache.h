// CRC is a candidate index; owned pixels and dimensions establish identity.
#ifndef C2S_PIXEL_IDENTITY_CACHE_H
#define C2S_PIXEL_IDENTITY_CACHE_H
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <map>
#include <utility>
#include <vector>

template<typename Value> class CPixelIdentityCache
{
    struct Entry
    {
        std::uint32_t width, height;
        long stride;
        std::vector<unsigned char> pixels;
        Value value;
    };
    std::map<std::uint32_t, std::vector<Entry>> entries;
    std::size_t bytes = 0, count = 0;
    std::size_t maxBytes, maxEntries;
public:
    explicit CPixelIdentityCache(std::size_t byteLimit = 64 * 1024 * 1024,
        std::size_t entryLimit = 4096) : maxBytes(byteLimit), maxEntries(entryLimit) {}
    Value Find(std::uint32_t checksum, std::uint32_t width, std::uint32_t height,
        long stride, const unsigned char* pixels, std::size_t size) const
    {
        if (!pixels || !size || !width || !height || !stride) return Value();
        const auto bucket = entries.find(checksum);
        if (bucket == entries.end()) return Value();
        for (const Entry& entry : bucket->second)
            if (entry.width == width && entry.height == height && entry.stride == stride &&
                entry.pixels.size() == size && std::memcmp(entry.pixels.data(), pixels, size) == 0)
                return entry.value;
        return Value();
    }
    void Remember(std::uint32_t checksum, std::uint32_t width, std::uint32_t height,
        long stride, const unsigned char* pixels, std::size_t size, const Value& value)
    {
        // Deduplication is optional. On budget exhaustion callers still emit a
        // fresh, uniquely named asset; image content is never dropped/replaced.
        if (!pixels || !size || !width || !height || !stride || count >= maxEntries ||
            size > maxBytes - bytes) return;
        Entry entry;
        entry.width = width; entry.height = height; entry.stride = stride;
        entry.pixels.assign(pixels, pixels + size); entry.value = value;
        entries[checksum].push_back(std::move(entry));
        bytes += size; ++count;
    }
    void clear() { entries.clear(); bytes = count = 0; }
};
#endif
