export type MultiArrayDimension = {
  label: string;
  size: number;
  stride: number;
};

export type MultiArrayLayout = {
  dim: MultiArrayDimension;
  data_offset: number;
};

export type std_msg__Float64MultiArray = {
  layout: MultiArrayLayout;
  data: Float64Array;
};


