// The surrounding native graphics buffer uses straight RGBA. AGG custom
// composition requires premultiplied destination/result pixels; bridge that
// contract with AGG's own conversion functions around the existing operator.
#ifndef C2S_STRAIGHT_BLEND_ADAPTOR_H
#define C2S_STRAIGHT_BLEND_ADAPTOR_H
#include "../agg-2.4/include/agg_pixfmt_rgba.h"
namespace Aggplus {
template<class ColorT,class Order>
struct CUnpremultipliedBlend : agg::comp_op_adaptor_rgba<ColorT,Order>
{
    static AGG_INLINE void blend_pix(unsigned op,typename ColorT::value_type* pixel,
        unsigned red,unsigned green,unsigned blue,unsigned alpha,unsigned cover)
    {
        const bool separable = op == agg::comp_op_src_over ||
            (op >= agg::comp_op_multiply && op <= agg::comp_op_exclusion);
        if (!cover || (!alpha && separable)) return;
        // A separable blend over a fully transparent backdrop is source-over.
        // Reuse that exact native operator; avoid needless burn/light integer
        // rounding before the destination has any backdrop color.
        if (!pixel[Order::A] && separable) op = agg::comp_op_src_over;
        agg::multiplier_rgba<ColorT,Order>::premultiply(pixel);
        agg::comp_op_adaptor_rgba<ColorT,Order>::blend_pix(op,pixel,red,green,blue,alpha,cover);
        agg::multiplier_rgba<ColorT,Order>::demultiply(pixel);
    }
};
}
#endif
