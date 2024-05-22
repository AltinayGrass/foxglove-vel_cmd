export declare type MultiArrayDimension = {
    label: string;
    size: number;
    stride: number;
};
export declare type MultiArrayLayout = {
    dim: MultiArrayDimension;
    data_offset: number;
};
export declare type std_msg__Float64MultiArray = {
    layout: MultiArrayLayout;
    data: Float64Array;
};
