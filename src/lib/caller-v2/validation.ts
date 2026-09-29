import { z } from 'zod';
export type Infer<S> = S extends z.ZodType ? z.infer<S> : never;
const text = (max = 5000, min = 0) => z.string().min(min).max(max);
const refine = <S extends z.ZodType>(base: S, check: (value: z.infer<S>) => boolean, message: string) => base.refine(check, message);
export const v = {
    text, refine, boolean: z.boolean(),
    number: (min = -Number.MAX_VALUE, max = Number.MAX_VALUE) => z.number().finite().min(min).max(max),
    nullable: <S extends z.ZodType>(item: S) => item.nullable(),
    object: <const S extends z.ZodRawShape>(shape: S) => z.object(shape).strict(),
    enum: <const T extends [string, ...string[]]>(values: T) => z.enum(values),
    array: <S extends z.ZodType>(item: S, max = 100) => z.array(item).max(max),
};
export const identifier = text(128, 1).regex(/^[A-Za-z0-9_-]+$/);
export const calendarDate = text(10, 10).refine(x => /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x + 'T12:00:00Z').toISOString().slice(0, 10) === x);
export const clockTime = text(5, 5).regex(/^([01]\d|2[0-3]):[0-5]\d$/);
