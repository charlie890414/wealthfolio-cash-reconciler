declare module 'big.js' {
  export default class Big {
    static readonly roundDown: 0;
    static readonly roundHalfUp: 1;
    constructor(value: string | number | Big);
    plus(value: string | number | Big): Big;
    minus(value: string | number | Big): Big;
    times(value: string | number | Big): Big;
    round(dp?: number, rm?: number): Big;
    toString(): string;
  }
}
