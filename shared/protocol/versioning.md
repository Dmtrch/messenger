# Shared Protocol Versioning

Этот документ фиксирует правила versioning для shared protocol contracts.

## Цель

Сохранить backward compatibility между:

- текущим web/PWA-клиентом;
- будущими desktop-клиентами;
- будущими android-клиентами;
- будущими ios-клиентами.

## Versioning rules

### Minor changes

`Minor` change допустим, если:

- добавляет необязательное поле;
- добавляет новый event без ломки старых payload;
- не меняет существующую semantics обязательных полей.

### Breaking changes

`Breaking` change считается любая правка, которая:

- меняет имя обязательного поля;
- меняет тип обязательного поля;
- меняет meaning существующего event;
- делает старый payload недекодируемым новым клиентом или наоборот.

## Backward compatibility

Backward compatibility обязательна по умолчанию.

Это означает:

1. Новый native-клиент должен уметь работать с текущим backend contract.
2. Новый backend contract не должен ломать текущий web-клиент без отдельного migration path.
3. Любая breaking-правка требует RFC или ADR с migration strategy.

## Practical guidance

- добавлять optional fields безопаснее, чем переименовывать existing fields;
- `Cursor` остаётся opaque value;
- crypto envelope versioning нельзя менять без отдельного compatibility-review.
