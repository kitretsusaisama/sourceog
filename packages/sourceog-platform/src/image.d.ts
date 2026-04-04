import React from "react";
export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    width: number;
    height: number;
    blurDataURL?: string;
}
export declare function Image(props: ImageProps): React.JSX.Element;
