---
keywords: color blindness simulation, svg filters
description: Protanopia and deuteranopia are easy to implement with a single matrix multiplication, but tritanopia requires special care and a more subtle pipeline. Let's see how we can still implement the state-of-the-art approach of Brettel et al. with SVG filters.
title: Accurate SVG filters for color blindness simulation
toc: true
badges: true
comments: true
categories: [simulation]
hide: false
permalink: /cvd-simulation-svg-filters/
layout: post
---

# Introduction

We have seen in [Review of Open Source Color Blindness
Simulations](opensource-cvd-simulation/) and [Understanding LMS-based Color
Blindness Simulations](understanding-cvd-simulation/) that a pretty accurate
simulation of the 3 main color vision deficiencies (protanopia, deuteranopia and
tritanopia) can be achieved by the {% cite brettel_computerized_1997 %} method,
and that a simpler viable algorithm for protanopia and deuteranopia is given by
{% cite vienot_digital_1999 %}.

Being able to do the CVD simulation via [SVG
filters](https://www.w3schools.com/graphics/svg_filters_intro.asp) is very handy
to enable efficient browser extension (eg.
[Colorblindly](https://github.com/oftheheadland/Colorblindly)) or even to
implement the [developer tools in Google
Chrome](https://developer.chrome.com/blog/cvd/) or Mozilla Firefox. This makes
it easy for web developers to check if their design is color blind
friendly.

The SVG filters primitives are quite limited though, mostly matrix
multiplication, convolution and blending.

The good news is that these CVD algorithms are pretty simple to implement,
especially the Viénot 1999 one. It ends up being a single 3x3 matrix
multiplication of the linear rgb values.

However the Brettel 1997 one is required for accurate tritanopia simulation, but
unfortunately it's a bit more complex. The direct implementation needs to
convert the RGB values to the LMS color space (one 3x3 matrix multiplication),
apply a dot product with the normal of the separation plane to choose one
projection matrix among two possibilities, apply the selected projection matrix
and go back to RGB from LMS (another 3x3 matrix multiplication). Let's see how
we can still implement that with an SVG filter.

# Starting easy, implementing the Viénot 1999 filter

The overall setup of the CSS + SVG properties in HTML is not our main topic
here, so I'll refer to e.g. [Simulating color vision deficiencies in the Blink
Renderer](https://developer.chrome.com/blog/cvd/) if you want more details.

A reference html page is available in
[libDaltonLens](https://github.com/DaltonLens/libDaltonLens/blob/master/svg/cvd_svg_filters.html),
which can be visualized directly [in this live
demo](https://daltonlens.github.io/libDaltonLens/svg/cvd_svg_filters.html).

This is what the code looks like for protanopia:

    <filter id="protanopia" color-interpolation-filters="linearRGB">
        <feColorMatrix type="matrix" in="SourceGraphic" values="
            0.10889,0.89111,-0.00000,0,0
            0.10889,0.89111,0.00000,0,0
            0.00447,-0.00447,1.00000,0,0
            0,0,0,1,0"
        />
    </filter>

`feColorMatrix` specifies a 4x5 matrix that takes a vector `[R G B A 1]` and
returns the transformed `[R' G' B' A']`. As we've seen in previous articles it
is very important that the filter happens in the linear RGB space, hence the
`color-interpolation-filters="linearRGB"` attribute. It should be the default,
but it never hurts to be explicit.

Here the matrix content was dumped from [DaltonLens-Python](https://github.com/DaltonLens/DaltonLens-Python), and it corresponds to a combined sequence of going from RGB to LMS, applying a projection and going back to RGB.

# Implementing Brettel 1997

Instead of a single projection matrix, Brettel 1997 needs two, one for each half-plane in the LMS space. Here is the pseudo-code:

    lms = LMS_from_RGB . rgb
    H = (planeSepNormal^t . lms  >= 0) ? H1 : H2
    lms_cvd = H . lms
    rgb_cvd = RGB_from_LMS . lms_cvd

with `LMS_from_RGB, RGB_from_LMS, H1 and H2` some constant 3x3 matrices (only depends on the CVD type), and `planeSepNormal` a 3d vector representing the normal of the separation plane in the LMS space.

We don't really have convenient conditionals with SVG filters, so it's not
straightforward to adapt. But first we can simplify this pipeline by combining
the two possible sequences into just two 3x3 matrices:
    
    rgb_cvd_from_rgb_1 = RGB_from_LMS . H1 . LMS_from_RGB
    rgb_cvd_from_rgb_2 = RGB_from_LMS . H2 . LMS_from_RGB

Then our problem becomes to choose between these two, and this can also be written without explicitly going to LMS:

    planeSepNormal . lms = planeSepNormal^t . LMS_from_RGB . rgb
                         = planeSepNormal_rgb . rgb

`planeSepNormal_rgb` is still a constant 3d vector and it can be precomputed. Now the overall pipeline becomes:

    H = (planeSepNormal_rgb . rgb >= 0) ? rgb_cvd_from_rgb_1 : rgb_cvd_from_rgb_2
    rgb_cvd = H . rgb

Ok, that seems easier! The feature which is the closest to a conditional in the SVG filter is `feBlend`. It takes two images as an input, and will combine then depending on the alpha values of each image. So instead of applying a conditional to each pixel, we can just generate two images, one with `rgb_cvd_from_rgb_1`, another one with `rgb_cvd_from_rgb_2`, and make sure that the first image has `alpha=1` when we should indeed pick the pixel from that first image, and `alpha=0` when we should take the value from the second image.

Our condition is `(planeSepNormal_rgb . rgb >= 0)`, we just need to transform that into an `alpha` that is either 0 or 1. Computing `alpha = planeSepNormal_rgb . rgb` is easy, we can just add `planeSepNormal_rgb` to the fourth row of the `feColorMatrix`. But then we need to threshold that so that alpha becomes 1 if it's higher than 0.

The primitive we can use to threshold is `feComponentTransfer` and `feFunc`. It has a `discrete` mode that can map slices of the input range into specific values. For example `<feFuncA type="discrete" tableValues="0 1"/>` would split the input range in two, and transform the alpha channel such that values between 0 and 0.5 become 0 and values between 0.5 and 1 become 1.

So one idea is to make the fourth row of `feColorMatrix` also include a 0.5 offset, such that `alpha = planeSepNormal_rgb . rgb + 0.5`. Then we can threshold that: values below 0.5 to 0 and values above it to 1. 

This almost works, but has two caveats:

- The original alpha information is lost. So this only works if the input graphics is fully opaque. Even worse, there is a weird situation with Google Chrome where some extra padding with zero transparency will get transformed (sounds like a bug). We can workaround that one by keeping the original alpha, but _subtracting_ 0.5 to it. This way if it was zero, it'll remain zero.

- Images are stored as 32 bit RGBA (8 bit per channel) with premultiplied alpha, which means that the intermediate rgb will be multiplied by a value centered around 0.5 and clamped + rounded to [0,255]. To avoid losing too much precision we can make it a bit higher, e.g. 0.8 and use a threshold that transforms values higher than 0.8 into 1 with `<feFuncA type="discrete" tableValues="0 0 0 0 1"/>`.

Combined together, we get this:

    <filter id="tritanopia" color-interpolation-filters="linearRGB">    
    <!-- 
        Projection on plane 1. 
        alpha < 0.8 means we should use the projection on plane 2 
    -->
    <feColorMatrix type="matrix" in="SourceGraphic" result="ProjectionOnPlane1" values="
        1.01354, 0.14268, -0.15622, 0, 0
        -0.01181, 0.87561, 0.13619, 0, 0
        0.07707, 0.81208, 0.11085, 0, 0
        7.92482, -5.66475, -2.26007, 1, -0.2"
        <!-- That last row is computing alpha -->
    />
    <!-- 
        Binarize alpha. 5 values means the last chunk will start at 0.8.
        All the values below 0.8 will become 0 (correspond to the dot
        product with the separation plane being negative) and above will become 1
    -->        
    <feComponentTransfer in="ProjectionOnPlane1" result="ProjectionOnPlane1">
        <feFuncA type="discrete" tableValues="0 0 0 0 1"/>
    </feComponentTransfer>

    <!-- Project on the second plane. -->
    <feColorMatrix type="matrix" in="SourceGraphic" result="ProjectionOnPlane2" values="
        0.93337, 0.19999, -0.13336, 0, 0
        0.05809, 0.82565, 0.11626, 0, 0
        -0.37923, 1.13825, 0.24098, 0, 0
        0,0,0,1,0"
    />

    <!-- Blend the two projections, picking one or the other depending on alpha. -->
    <feBlend in="ProjectionOnPlane1" in2="ProjectionOnPlane2" mode="normal"/>
    </filter>

# Conclusion

This filter does the job overall for opaque content and is pretty efficient. We still need to address the loss of the alpha channel to actually use it to render entire webpages. I tried to play around with an additional blending to transfer the alpha channel of the source image to the final image, but without success so far, and I ran out of time for this experiment. Let me know if you have an idea!

# Bibliography

{% bibliography --cited %}
