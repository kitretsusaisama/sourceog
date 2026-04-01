import React from "react";

export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  width: number;
  height: number;
  blurDataURL?: string;
}

export function Image(props: ImageProps): React.JSX.Element {
  const { width, height, blurDataURL, style, loading, ...rest } = props;
  return (
    <img
      {...rest}
      width={width}
      height={height}
      loading={loading ?? "lazy"}
      style={{
        aspectRatio: `${width} / ${height}`,
        backgroundSize: "cover",
        backgroundImage: blurDataURL ? `url(${blurDataURL})` : undefined,
        ...style
      }}
    />
  );
}
