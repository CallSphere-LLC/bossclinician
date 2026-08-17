import { LuxeInput, LuxeSelect } from "@/components/luxe/LuxeField";
import { COUNTRIES, US_STATES } from "@/components/checkout/places";

export interface AddressValue {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export const EMPTY_ADDRESS: AddressValue = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

interface BillingAddressFieldsProps {
  value: AddressValue;
  errors: Record<string, string>;
  onChange: (patch: Partial<AddressValue>) => void;
  disabled?: boolean;
}

/**
 * The billing address, shown only when the offer asks for one.
 *
 * Country and — in the US — state are selects rather than text, because the
 * sales-tax rate is looked up from those two codes. Changing the country clears
 * the state: "CA" means California under US and nothing at all under Canada, and
 * carrying it across is how an order gets taxed at the wrong rate.
 */
export function BillingAddressFields({
  value,
  errors,
  onChange,
  disabled = false,
}: BillingAddressFieldsProps) {
  const isUS = value.country === "US";

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <LuxeSelect
        label="Country"
        required
        wrapperClassName="sm:col-span-2"
        value={value.country}
        error={errors.country}
        disabled={disabled}
        autoComplete="country"
        onChange={(e) => onChange({ country: e.target.value, state: "" })}
      >
        {COUNTRIES.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </LuxeSelect>

      <LuxeInput
        label="Street address"
        required
        wrapperClassName="sm:col-span-2"
        value={value.line1}
        error={errors.line1}
        disabled={disabled}
        autoComplete="address-line1"
        onChange={(e) => onChange({ line1: e.target.value })}
      />

      <LuxeInput
        label="Apartment, suite, etc."
        wrapperClassName="sm:col-span-2"
        value={value.line2}
        disabled={disabled}
        autoComplete="address-line2"
        onChange={(e) => onChange({ line2: e.target.value })}
      />

      <LuxeInput
        label="City"
        value={value.city}
        error={errors.city}
        disabled={disabled}
        autoComplete="address-level2"
        onChange={(e) => onChange({ city: e.target.value })}
      />

      {isUS ? (
        <LuxeSelect
          label="State"
          value={value.state}
          error={errors.state}
          disabled={disabled}
          autoComplete="address-level1"
          onChange={(e) => onChange({ state: e.target.value })}
        >
          <option value="">Choose your state…</option>
          {US_STATES.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </LuxeSelect>
      ) : (
        <LuxeInput
          label="State or province"
          value={value.state}
          error={errors.state}
          disabled={disabled}
          autoComplete="address-level1"
          onChange={(e) => onChange({ state: e.target.value })}
        />
      )}

      <LuxeInput
        label="ZIP / postal code"
        wrapperClassName="sm:col-span-2"
        value={value.postalCode}
        error={errors.postalCode}
        disabled={disabled}
        autoComplete="postal-code"
        inputMode={isUS ? "numeric" : "text"}
        onChange={(e) => onChange({ postalCode: e.target.value })}
      />
    </div>
  );
}
